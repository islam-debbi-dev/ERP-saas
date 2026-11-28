import { Injectable } from '@nestjs/common';
import {
  type AssignSellerZoneInput,
  ErrorCode,
  isFieldSeller,
  isTeamLead,
  Role,
  type SellerZoneAssignmentDto,
  type SellerZoneAssignmentPage,
  type ZoneAssignmentQuery,
} from '@erp/shared';
import { communeByCode, isCommuneUnderReview, zoneCommuneCodes } from '@erp/shared/communes';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from './scope.service';
import { responsibleCommunes } from './zone-cover';
import { lockZones } from './zone-locks';

const include = {
  zone: {
    select: { id: true, name: true, deletedAt: true, wilayaCodes: true, communeCodes: true },
  },
  assigner: { select: { id: true, fullName: true } },
} satisfies Prisma.SellerZoneAssignmentInclude;

type Row = Prisma.SellerZoneAssignmentGetPayload<{ include: typeof include }>;

function toDto(a: Row): SellerZoneAssignmentDto {
  return {
    id: a.id,
    userId: a.userId,
    zone: a.zone ? { id: a.zone.id, name: a.zone.name, deleted: a.zone.deletedAt !== null } : null,
    communeCodes: a.zone ? zoneCommuneCodes(a.zone) : a.communeCodes,
    validFrom: a.validFrom.toISOString(),
    validTo: a.validTo?.toISOString() ?? null,
    assignedBy: a.assigner,
  };
}

/**
 * Where each seller and pré-vendeur works (phase 40b). A move closes the open row and opens
 * a new one in one transaction; rows are never edited otherwise. The owner and managers
 * assign anyone anywhere; a supervisor or chef de zone assigns his own people, inside the
 * zones he is responsible for.
 */
@Injectable()
export class SellerZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async assign(
    userId: string,
    input: AssignSellerZoneInput,
    actor: CurrentUserInfo,
  ): Promise<SellerZoneAssignmentDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      // The company first, then the user: the same order as every user write.
      await lockZones(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid FOR NO KEY UPDATE`;
      const target = await tx.user.findFirst({
        where: { id: userId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!target) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
      await this.assertLeads(tx, actor, userId);
      if (target.deletedAt || !isFieldSeller(target.role)) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          'Only an active seller or pre-seller is assigned to a zone',
          { field: 'userId' },
        );
      }
      const cover = await this.cover(tx, input);
      if (isTeamLead(actor.role)) {
        const own = new Set(await responsibleCommunes(tx, actor.id));
        const outside = cover.filter((code) => !own.has(code));
        if (outside.length > 0 || cover.length === 0) {
          throw new AppException(ErrorCode.ZONE_OUTSIDE_SCOPE, 'Outside your own zones', {
            communeCodes: outside.slice(0, 20),
          });
        }
      }
      const open = await tx.sellerZoneAssignment.findFirst({ where: { userId, validTo: null } });
      // Never before the row it closes, whatever the clocks of two servers say.
      const now = this.clock.now();
      const at = open && open.validFrom > now ? open.validFrom : now;
      if (open) {
        await tx.sellerZoneAssignment.updateMany({
          where: { id: open.id, validTo: null },
          data: { validTo: at },
        });
      }
      const row = await tx.sellerZoneAssignment.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          userId,
          zoneId: input.zoneId ?? null,
          communeCodes: input.communeCodes ?? [],
          validFrom: at,
          assignedBy: actor.id,
        },
      });
      await this.audit.log(tx, {
        action: 'SELLER_ZONE_ASSIGNED',
        entity: 'SellerZoneAssignment',
        entityId: row.id,
        before: open
          ? { id: open.id, zoneId: open.zoneId, communeCodes: open.communeCodes }
          : undefined,
        after: { userId, zoneId: row.zoneId, communeCodes: row.communeCodes, validFrom: at },
      });
      return row.id;
    });
    return toDto(
      await this.prisma.db.sellerZoneAssignment.findFirstOrThrow({ where: { id }, include }),
    );
  }

  /** The current assignment and the history, newest first. His own, or one he leads. */
  async history(
    userId: string,
    query: ZoneAssignmentQuery,
    actor: CurrentUserInfo,
  ): Promise<SellerZoneAssignmentPage> {
    const target = await this.prisma.db.user.findFirst({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
    if (actor.id !== userId) await this.assertLeads(this.prisma.db, actor, userId);
    const [current, rows] = await Promise.all([
      this.prisma.db.sellerZoneAssignment.findFirst({
        where: { userId, validTo: null },
        include,
      }),
      this.prisma.db.sellerZoneAssignment.findMany({
        where: { userId },
        include,
        // The open row first among rows of the same instant.
        orderBy: [
          { validFrom: 'desc' },
          { validTo: { sort: 'desc', nulls: 'first' } },
          { id: 'desc' },
        ],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);
    const items = rows.slice(0, query.limit);
    return {
      current: current ? toDto(current) : null,
      items: items.map(toDto),
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
    };
  }

  /** Office: anyone. A supervisor or chef de zone: his team. Others: refused. */
  private async assertLeads(
    db: PrismaService['db'] | Tx,
    actor: CurrentUserInfo,
    userId: string,
  ): Promise<void> {
    if (actor.role === Role.OWNER || actor.role === Role.MANAGER) return;
    if (isTeamLead(actor.role) && (await this.scope.teamIds(actor.id, db)).includes(userId)) return;
    throw new AppException(ErrorCode.FORBIDDEN, 'This user is not in your team', {
      field: 'userId',
    });
  }

  /** The communes the assignment would give, after checking them. */
  private async cover(tx: Tx, input: AssignSellerZoneInput): Promise<number[]> {
    if (input.zoneId) {
      const zone = await tx.fieldZone.findFirst({ where: { id: input.zoneId, deletedAt: null } });
      if (!zone) throw new AppException(ErrorCode.NOT_FOUND, 'Zone not found');
      return zoneCommuneCodes(zone);
    }
    const codes = input.communeCodes!;
    for (const code of codes) {
      if (!communeByCode(code)) {
        throw new AppException(ErrorCode.COMMUNE_UNKNOWN, 'Unknown commune code', {
          communeCode: code,
        });
      }
      if (isCommuneUnderReview(code)) {
        throw new AppException(
          ErrorCode.COMMUNE_UNDER_REVIEW,
          'This commune cannot be chosen until its new wilaya is checked',
          { communeCode: code },
        );
      }
    }
    return codes;
  }
}
