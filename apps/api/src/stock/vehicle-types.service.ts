import { Injectable } from '@nestjs/common';
import {
  type CreateVehicleTypeInput,
  ErrorCode,
  type UpdateVehicleTypeInput,
  type VehicleTypeDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const typeInclude = {
  _count: { select: { vehicles: { where: { deletedAt: null } } } },
} satisfies Prisma.VehicleTypeInclude;

type TypeRow = Prisma.VehicleTypeGetPayload<{ include: typeof typeInclude }>;

const toDto = (t: TypeRow): VehicleTypeDto => ({
  id: t.id,
  code: t.code,
  name: t.name,
  codePrefix: t.codePrefix,
  activity: t.activity,
  active: t.active,
  vehicleCount: t._count.vehicles,
});

/**
 * Vehicle types (phase 36): the company's own kinds of trucks (`MXT`, `SELF/MT`, `MIX`).
 * We never ship a list: only the activity behind each type is ours. Master data,
 * archived and never deleted; a type a live truck still has cannot be archived.
 */
@Injectable()
export class VehicleTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<VehicleTypeDto[]> {
    const rows = await this.prisma.db.vehicleType.findMany({
      where: { deletedAt: null },
      include: typeInclude,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<VehicleTypeDto> {
    const t = await this.prisma.db.vehicleType.findFirst({
      where: { id, deletedAt: null },
      include: typeInclude,
    });
    if (!t) throw this.notFound();
    return toDto(t);
  }

  async create(input: CreateVehicleTypeInput): Promise<VehicleTypeDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.assertCodeFree(tx, input.code, null);
      const t = await this.write(() =>
        tx.vehicleType.create({
          data: { tenantId: tenantContext.requireTenantId(), ...input },
        }),
      );
      await this.audit.log(tx, {
        action: 'VEHICLE_TYPE_CREATED',
        entity: 'VehicleType',
        entityId: t.id,
        after: input,
      });
      return t.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateVehicleTypeInput): Promise<VehicleTypeDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      if (input.code !== undefined) await this.assertCodeFree(tx, input.code, id);
      await this.write(() => tx.vehicleType.update({ where: { id }, data: input }));
      await this.audit.log(tx, {
        action: 'VEHICLE_TYPE_UPDATED',
        entity: 'VehicleType',
        entityId: id,
        before: {
          code: before.code,
          name: before.name,
          codePrefix: before.codePrefix,
          activity: before.activity,
          active: before.active,
        },
        after: input,
      });
    });
    return this.get(id);
  }

  /** Archives a type no live truck has. The row lock keeps a truck from taking it meanwhile. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      const vehicles = await tx.warehouse.count({ where: { vehicleTypeId: id, deletedAt: null } });
      if (vehicles > 0) {
        throw new AppException(ErrorCode.VEHICLE_TYPE_IN_USE, 'Vehicles still have this type', {
          vehicles,
        });
      }
      await tx.vehicleType.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      });
      await this.audit.log(tx, {
        action: 'VEHICLE_TYPE_ARCHIVED',
        entity: 'VehicleType',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /**
   * The live type a truck is given, locked FOR SHARE so it cannot be archived before the
   * truck is saved. Unknown, archived or another company's: VEHICLE_TYPE_NOT_FOUND.
   */
  async assertUsable(tx: Tx, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM vehicle_types
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND "deletedAt" IS NULL
      FOR SHARE`;
    if (rows.length === 0) throw this.notFound({ field: 'vehicleTypeId' });
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`
      SELECT id FROM vehicle_types
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const t = await tx.vehicleType.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw this.notFound();
    return t;
  }

  private async assertCodeFree(tx: Tx, code: string, exceptId: string | null): Promise<void> {
    const taken = await tx.vehicleType.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw this.codeTaken();
  }

  /** The partial unique index is the last word when two requests race. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.codeTaken();
      }
      throw err;
    }
  }

  private codeTaken(): AppException {
    return new AppException(ErrorCode.VEHICLE_CODE_TAKEN, 'Code already used', { field: 'code' });
  }

  private notFound(details?: Record<string, unknown>): AppException {
    return new AppException(ErrorCode.VEHICLE_TYPE_NOT_FOUND, 'Vehicle type not found', details);
  }
}
