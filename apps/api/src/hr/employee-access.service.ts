import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { dayEmployeeSelect, type DayEmployee } from './attendance-days.service';

type Db = PrismaService['db'] | Tx;

export type LockedEmployee = DayEmployee & { fullName: string; deletedAt: Date | null };

/**
 * Which employees a user reaches (phase 31, phase 24 rules): those of the dépôts he works
 * in. Outside his reach an employee is not there (404), never an error that reveals him.
 */
@Injectable()
export class EmployeeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  /** Employees of these dépôts; a row without dépôt counts as the dépôt principal's. */
  async where(
    user: CurrentUserInfo,
    level: 'operate' | 'stats',
    warehouseId: string | undefined,
    db: Db = this.prisma.db,
  ): Promise<Prisma.EmployeeWhereInput> {
    const units = await this.scope.warehouses(user, db);
    const reach = level === 'operate' ? units.warehouseIds : units.statsWarehouseIds;
    const ids = this.scope.narrowWarehouses(reach, warehouseId);
    return (
      this.scope.warehouseWhere(
        { userId: user.id, defaultWarehouseId: units.defaultWarehouseId },
        ids,
        'createdBy',
      ) ?? {}
    );
  }

  async assertReach(db: Db, user: CurrentUserInfo, employeeId: string): Promise<void> {
    const found = await db.employee.findFirst({
      where: { AND: [{ id: employeeId }, await this.where(user, 'operate', undefined, db)] },
      select: { id: true },
    });
    if (!found) throw new AppException(ErrorCode.NOT_FOUND, 'Employee not found');
  }

  /** Locks the rows in id order, so two calls on the same people never deadlock. */
  async lock(tx: Tx, employeeIds: string[]): Promise<Map<string, LockedEmployee>> {
    const ids = [...new Set(employeeIds)].sort();
    const tenantId = tenantContext.requireTenantId();
    await tx.$queryRaw`
      SELECT id FROM employees
      WHERE id = ANY(${ids}::uuid[]) AND "tenantId" = ${tenantId}::uuid
      ORDER BY id FOR UPDATE`;
    const rows = await tx.employee.findMany({
      where: { id: { in: ids } },
      select: { ...dayEmployeeSelect, fullName: true, deletedAt: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The employee file of the signed-in user. */
  async own(db: Db, user: CurrentUserInfo): Promise<{ id: string }> {
    const employee = await db.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!employee) {
      throw new AppException(ErrorCode.EMPLOYEE_NOT_LINKED, 'No employee file for this user');
    }
    return employee;
  }
}
