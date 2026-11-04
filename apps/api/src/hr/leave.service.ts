import { Injectable } from '@nestjs/common';
import {
  type CreateLeaveRequestInput,
  ErrorCode,
  type LeaveBalanceDto,
  LeaveEntryType,
  leaveDaysTaken,
  type LeaveRequestDto,
  type LeaveRequestListQuery,
  type LeaveRequestPage,
  LeaveRequestStatus,
  leaveUsesBalance,
  listDays,
  money,
  Permission,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can, requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AttendanceDaysService, fromDay, toDay } from './attendance-days.service';
import { EmployeeAccessService, type LockedEmployee } from './employee-access.service';
import { EmployeeLedgerService } from './employee-ledger.service';

const include = {
  employee: { select: { id: true, matricule: true, fullName: true } },
} satisfies Prisma.LeaveRequestInclude;
type LeaveRow = Prisma.LeaveRequestGetPayload<{ include: typeof include }>;

const LONG_TX = { timeout: 30_000 };

/** Congés (phase 31): requests, and the ledger entries an approval posts. */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EmployeeAccessService,
    private readonly days: AttendanceDaysService,
    private readonly ledger: EmployeeLedgerService,
  ) {}

  private async toDtos(rows: LeaveRow[]): Promise<LeaveRequestDto[]> {
    const ids = [...new Set(rows.map((r) => r.decidedBy).filter((u): u is string => !!u))];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      employee: r.employee,
      startDate: toDay(r.startDate),
      endDate: toDay(r.endDate),
      type: r.type,
      status: r.status,
      days: r.days.toFixed(1),
      note: r.note,
      decisionReason: r.decisionReason,
      decidedBy: r.decidedBy ? (byId.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async one(id: string): Promise<LeaveRequestDto> {
    const row = await this.prisma.db.leaveRequest.findFirstOrThrow({ where: { id }, include });
    return (await this.toDtos([row]))[0]!;
  }

  async list(query: LeaveRequestListQuery, user: CurrentUserInfo): Promise<LeaveRequestPage> {
    const rows = await this.prisma.db.leaveRequest.findMany({
      where: {
        employee: await this.access.where(user, 'operate', query.warehouseId),
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      },
      include,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: await this.toDtos(page),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async forEmployee(employeeId: string): Promise<LeaveRequestDto[]> {
    const rows = await this.prisma.db.leaveRequest.findMany({
      where: { employeeId },
      include,
      orderBy: { startDate: 'desc' },
      take: 20,
    });
    return this.toDtos(rows);
  }

  async balance(employeeId: string, user: CurrentUserInfo): Promise<LeaveBalanceDto> {
    await this.access.assertReach(this.prisma.db, user, employeeId);
    const [balance, entries] = await Promise.all([
      this.prisma.db.employeeBalance.findUnique({ where: { employeeId } }),
      this.prisma.db.leaveEntry.findMany({
        where: { employeeId },
        orderBy: { seq: 'desc' },
        take: 100,
      }),
    ]);
    return {
      balance: balance?.leaveDays.toFixed(1) ?? '0.0',
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        days: e.days.toFixed(1),
        month: e.month,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  private async workingDays(tx: Tx, e: LockedEmployee, from: string, to: string): Promise<number> {
    const calendar = await this.days.calendar(tx, tenantContext.requireTenantId(), from, to);
    return leaveDaysTaken(from, to, this.days.calendarOf(e, calendar));
  }

  /** The user's own file by default; asking for someone else takes a manager's right. */
  async create(input: CreateLeaveRequestInput, user: CurrentUserInfo): Promise<LeaveRequestDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const own = await tx.employee.findFirst({
        where: { userId: user.id, deletedAt: null },
        select: { id: true },
      });
      const employeeId = input.employeeId ?? (await this.access.own(tx, user)).id;
      if (employeeId !== own?.id) {
        if (!can(user, Permission.LEAVE_APPROVE)) {
          requirePermission(user, Permission.ATTENDANCE_MARK);
        }
        await this.access.assertReach(tx, user, employeeId);
      }
      const employee = (await this.access.lock(tx, [employeeId])).get(employeeId);
      if (!employee || employee.deletedAt) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Employee not found');
      }
      if (input.startDate < toDay(employee.hireDate)) {
        throw new AppException(ErrorCode.EMPLOYEE_NOT_EMPLOYED, 'Before the hire date');
      }
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
          startDate: { lte: fromDay(input.endDate) },
          endDate: { gte: fromDay(input.startDate) },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new AppException(ErrorCode.LEAVE_OVERLAP, 'Overlaps another leave', {
          leaveRequestId: overlap.id,
        });
      }
      const days = await this.workingDays(tx, employee, input.startDate, input.endDate);
      if (days === 0) {
        throw new AppException(ErrorCode.LEAVE_NO_WORKING_DAY, 'No working day in this range');
      }
      const row = await tx.leaveRequest.create({
        data: {
          tenantId,
          employeeId,
          startDate: fromDay(input.startDate),
          endDate: fromDay(input.endDate),
          type: input.type,
          days,
          note: input.note,
          createdBy: user.id,
        },
        select: { id: true },
      });
      await this.audit.log(tx, {
        action: 'LEAVE_REQUESTED',
        entity: 'LeaveRequest',
        entityId: row.id,
        after: { employeeId, ...input, days },
      });
      return row.id;
    });
    return this.one(id);
  }

  /** Locks the request, then its employee: the order every path here uses. */
  private async lockRequest(tx: Tx, id: string) {
    await tx.$queryRaw`
      SELECT id FROM leave_requests
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const request = await tx.leaveRequest.findFirst({ where: { id } });
    if (!request) throw new AppException(ErrorCode.NOT_FOUND, 'Leave request not found');
    const employee = (await this.access.lock(tx, [request.employeeId])).get(request.employeeId)!;
    return { request, employee };
  }

  /** Posts TAKEN for the working days, all or nothing. Beyond the balance only warns. */
  async approve(id: string, user: CurrentUserInfo): Promise<LeaveRequestDto> {
    let overBalance = false;
    await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const { request, employee } = await this.lockRequest(tx, id);
      await this.access.assertReach(tx, user, request.employeeId).catch(() => {
        throw new AppException(ErrorCode.NOT_FOUND, 'Leave request not found');
      });
      if (request.status !== LeaveRequestStatus.PENDING) {
        throw new AppException(ErrorCode.LEAVE_NOT_PENDING, 'Already decided', {
          status: request.status,
        });
      }
      const from = toDay(request.startDate);
      const to = toDay(request.endDate);
      const range = listDays(from, to);
      await this.days.assertUnlocked(tx, tenantId, employee.warehouseId, range);
      // The calendar may have changed since the request (a fête entered in between).
      const days = await this.workingDays(tx, employee, from, to);
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: LeaveRequestStatus.APPROVED,
          days,
          decidedBy: user.id,
          decidedAt: new Date(),
        },
      });
      if (leaveUsesBalance(request.type) && days > 0) {
        const after = await this.ledger.postLeave(tx, {
          employeeId: request.employeeId,
          type: LeaveEntryType.TAKEN,
          days: (-days).toFixed(1),
          leaveRequestId: id,
          userId: user.id,
        });
        overBalance = money(after).isNegative();
      }
      await this.days.recompute(tx, employee, range);
      await this.audit.log(tx, {
        action: 'LEAVE_APPROVED',
        entity: 'LeaveRequest',
        entityId: id,
        before: { status: request.status },
        after: { days, overBalance },
      });
    }, LONG_TX);
    return { ...(await this.one(id)), overBalance };
  }

  async reject(id: string, reason: string, user: CurrentUserInfo): Promise<LeaveRequestDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const { request } = await this.lockRequest(tx, id);
      await this.access.assertReach(tx, user, request.employeeId).catch(() => {
        throw new AppException(ErrorCode.NOT_FOUND, 'Leave request not found');
      });
      if (request.status !== LeaveRequestStatus.PENDING) {
        throw new AppException(ErrorCode.LEAVE_NOT_PENDING, 'Already decided', {
          status: request.status,
        });
      }
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: LeaveRequestStatus.REJECTED,
          decisionReason: reason,
          decidedBy: user.id,
          decidedAt: new Date(),
        },
      });
      await this.audit.log(tx, {
        action: 'LEAVE_REJECTED',
        entity: 'LeaveRequest',
        entityId: id,
        after: { reason },
      });
    });
    return this.one(id);
  }

  /**
   * A pending request can be withdrawn by its employee. An approved one takes LEAVE_APPROVE,
   * and its days come back through a reverse entry: the ledger is never edited.
   */
  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<LeaveRequestDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const { request, employee } = await this.lockRequest(tx, id);
      const own = await tx.employee.findFirst({
        where: { id: request.employeeId, userId: user.id },
        select: { id: true },
      });
      const manager = can(user, Permission.LEAVE_APPROVE);
      if (!own || request.status === LeaveRequestStatus.APPROVED) {
        if (!manager && !own)
          throw new AppException(ErrorCode.NOT_FOUND, 'Leave request not found');
        requirePermission(user, Permission.LEAVE_APPROVE);
        await this.access.assertReach(tx, user, request.employeeId).catch(() => {
          throw new AppException(ErrorCode.NOT_FOUND, 'Leave request not found');
        });
      }
      const approved = request.status === LeaveRequestStatus.APPROVED;
      if (!approved && request.status !== LeaveRequestStatus.PENDING) {
        throw new AppException(ErrorCode.LEAVE_NOT_APPROVED, 'Nothing to cancel', {
          status: request.status,
        });
      }
      const range = listDays(toDay(request.startDate), toDay(request.endDate));
      if (approved) await this.days.assertUnlocked(tx, tenantId, employee.warehouseId, range);
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: LeaveRequestStatus.CANCELLED,
          decisionReason: reason,
          decidedBy: user.id,
          decidedAt: new Date(),
        },
      });
      if (approved) {
        const entries = await tx.leaveEntry.findMany({
          where: { leaveRequestId: id },
          select: { days: true },
        });
        const net = entries.reduce((t, e) => t.add(money(e.days.toString())), money(0));
        if (!net.isZero()) {
          await this.ledger.postLeave(tx, {
            employeeId: request.employeeId,
            type: LeaveEntryType.ADJUST,
            days: net.neg().toFixed(1),
            leaveRequestId: id,
            note: reason,
            userId: user.id,
          });
        }
        await this.days.recompute(tx, employee, range);
      }
      await this.audit.log(tx, {
        action: 'LEAVE_CANCELLED',
        entity: 'LeaveRequest',
        entityId: id,
        before: { status: request.status },
        after: { reason },
      });
    }, LONG_TX);
    return this.one(id);
  }
}
