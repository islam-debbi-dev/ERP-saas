import { Injectable } from '@nestjs/common';
import {
  type CreateZoneInput,
  ErrorCode,
  Role,
  type UpdateZoneInput,
  ZoneKind,
  type ZoneDto,
} from '@erp/shared';
import { communeByCode, isCommuneUnderReview, zoneCommuneCodes } from '@erp/shared/communes';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type FieldZone, type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { lockZones } from './zone-locks';

const include = {
  parent: { select: { name: true } },
  responsible: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.FieldZoneInclude;

type Row = Prisma.FieldZoneGetPayload<{ include: typeof include }>;

/** Who may be responsible for a zone of each kind. */
const RESPONSIBLE_ROLES: Record<ZoneKind, readonly Role[]> = {
  [ZoneKind.AREA]: [Role.AREA_MANAGER],
  [ZoneKind.CITY]: [Role.SUPERVISOR, Role.AREA_MANAGER],
};
/** Details of a refusal list this many communes at most. */
const SHOWN = 20;

function toDto(z: Row): ZoneDto {
  return {
    id: z.id,
    name: z.name,
    kind: z.kind,
    parentZoneId: z.parentZoneId,
    parentZoneName: z.parent?.name ?? null,
    wilayaCodes: z.wilayaCodes,
    communeCodes: z.communeCodes,
    responsible: z.responsible,
    version: z.version,
  };
}

/** The columns kept in the audit log. */
function snapshot(z: FieldZone) {
  return {
    name: z.name,
    kind: z.kind,
    parentZoneId: z.parentZoneId,
    wilayaCodes: z.wilayaCodes,
    communeCodes: z.communeCodes,
    responsibleUserId: z.responsibleUserId,
  };
}

/**
 * Field zones (phase 40b). The owner and managers write them; every write locks the zones
 * of the company, so the two rules hold under concurrent edits: two live zones of one kind
 * share no commune, and an area covers its city zones.
 */
@Injectable()
export class ZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: CurrentUserInfo): Promise<ZoneDto[]> {
    const rows = await this.prisma.db.fieldZone.findMany({
      where: this.visible(user),
      include,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(id: string, user: CurrentUserInfo): Promise<ZoneDto> {
    const row = await this.prisma.db.fieldZone.findFirst({
      where: { AND: [{ id }, this.visible(user)] },
      include,
    });
    if (!row) throw notFound();
    return toDto(row);
  }

  async create(input: CreateZoneInput, user: CurrentUserInfo): Promise<ZoneDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await lockZones(tx);
      await this.check(tx, input, null);
      const zone = await tx.fieldZone.create({
        data: { ...input, tenantId: tenantContext.requireTenantId() },
      });
      await this.audit.log(tx, {
        action: 'ZONE_CREATED',
        entity: 'FieldZone',
        entityId: zone.id,
        after: snapshot(zone),
      });
      return zone.id;
    });
    return this.get(id, user);
  }

  async update(id: string, input: UpdateZoneInput, user: CurrentUserInfo): Promise<ZoneDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await lockZones(tx);
      const before = await tx.fieldZone.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound();
      if (before.version !== input.version) {
        throw new AppException(ErrorCode.CONFLICT, 'The zone changed since it was read', {
          currentVersion: before.version,
        });
      }
      if (before.kind !== input.kind) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'The kind of a zone does not change', {
          field: 'kind',
        });
      }
      await this.check(tx, input, before);
      const { version: _, ...data } = input;
      const after = await tx.fieldZone.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'ZONE_UPDATED',
        entity: 'FieldZone',
        entityId: id,
        before: snapshot(before),
        after: snapshot(after),
      });
    });
    return this.get(id, user);
  }

  /** Soft delete. Refused while a city sits in it or somebody is assigned to it. */
  async remove(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await lockZones(tx);
      const before = await tx.fieldZone.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound();
      const cities = await tx.fieldZone.count({ where: { parentZoneId: id, deletedAt: null } });
      const sellers = await tx.sellerZoneAssignment.count({ where: { zoneId: id, validTo: null } });
      if (cities > 0 || sellers > 0) {
        throw new AppException(ErrorCode.ZONE_IN_USE, 'This zone is still in use', {
          cities,
          sellers,
        });
      }
      await tx.fieldZone.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'ZONE_DELETED',
        entity: 'FieldZone',
        entityId: id,
        before: snapshot(before),
      });
    });
  }

  /**
   * Owner and manager: every live zone. A chef de zone: the zones he is responsible for and
   * the cities inside them. A supervisor: the zones he is responsible for.
   */
  private visible(user: CurrentUserInfo): Prisma.FieldZoneWhereInput {
    if (user.role === Role.OWNER || user.role === Role.MANAGER) return { deletedAt: null };
    const own = { responsibleUserId: user.id };
    return {
      deletedAt: null,
      OR: user.role === Role.AREA_MANAGER ? [own, { parent: { ...own, deletedAt: null } }] : [own],
    };
  }

  /** Every rule of a zone about to be written; `before` is null on a create. */
  private async check(tx: Tx, input: CreateZoneInput, before: FieldZone | null): Promise<void> {
    for (const code of input.communeCodes) {
      if (!communeByCode(code)) {
        throw new AppException(ErrorCode.COMMUNE_UNKNOWN, 'Unknown commune code', {
          communeCode: code,
        });
      }
    }
    const cover = zoneCommuneCodes(input);
    const had = new Set(before ? zoneCommuneCodes(before) : []);
    const gated = cover.find((code) => isCommuneUnderReview(code) && !had.has(code));
    if (gated !== undefined) {
      throw new AppException(
        ErrorCode.COMMUNE_UNDER_REVIEW,
        'This commune cannot be chosen until its new wilaya is checked',
        { communeCode: gated },
      );
    }
    await this.checkResponsible(tx, input);
    const others = await tx.fieldZone.findMany({
      where: { deletedAt: null, ...(before ? { id: { not: before.id } } : {}) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const mine = new Set(cover);
    for (const other of others.filter((z) => z.kind === input.kind)) {
      const shared = zoneCommuneCodes(other).filter((code) => mine.has(code));
      if (shared.length > 0) {
        throw new AppException(
          ErrorCode.ZONE_COMMUNE_TAKEN,
          'A commune is already in another zone of this kind',
          { zoneId: other.id, zoneName: other.name, communeCodes: shared.slice(0, SHOWN) },
        );
      }
    }
    if (input.parentZoneId !== null) {
      const parent = others.find((z) => z.id === input.parentZoneId && z.kind === ZoneKind.AREA);
      if (!parent) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'The parent must be a live area', {
          field: 'parentZoneId',
        });
      }
      assertInside(cover, zoneCommuneCodes(parent), {
        zoneName: input.name,
        areaName: parent.name,
      });
    }
    if (before && input.kind === ZoneKind.AREA) {
      for (const city of others.filter((z) => z.parentZoneId === before.id)) {
        assertInside(zoneCommuneCodes(city), cover, { zoneName: city.name, areaName: input.name });
      }
    }
  }

  private async checkResponsible(tx: Tx, input: CreateZoneInput): Promise<void> {
    if (input.responsibleUserId === null) return;
    const user = await tx.user.findFirst({
      where: {
        id: input.responsibleUserId,
        deletedAt: null,
        role: { in: [...RESPONSIBLE_ROLES[input.kind]] },
      },
      select: { id: true },
    });
    if (!user) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'This user cannot be responsible for this zone',
        { field: 'responsibleUserId', allowedRoles: RESPONSIBLE_ROLES[input.kind] },
      );
    }
  }
}

function assertInside(
  city: number[],
  area: number[],
  names: { zoneName: string; areaName: string },
): void {
  const covered = new Set(area);
  const outside = city.filter((code) => !covered.has(code));
  if (outside.length === 0) return;
  throw new AppException(ErrorCode.ZONE_NOT_INSIDE_AREA, 'The area does not cover this city', {
    ...names,
    communeCodes: outside.slice(0, SHOWN),
  });
}

function notFound(): AppException {
  return new AppException(ErrorCode.NOT_FOUND, 'Zone not found');
}
