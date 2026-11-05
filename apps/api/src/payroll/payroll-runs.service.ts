import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type ApprovePayrollRunInput,
  BLOCKING_PAYSLIP_ISSUES,
  type CancelPayrollRunInput,
  type CreatePayrollRunInput,
  DocType,
  EmployeeLedgerType,
  ErrorCode,
  Feature,
  type IrgDetail,
  money,
  monthBounds,
  type PatchPayrollRunParsed,
  type PayDaySummary,
  type PayLineCode,
  type PayPayrollRunInput,
  type PayrollManualLineInput,
  PayrollManualKind,
  type PayrollRunDetailDto,
  type PayrollRunDto,
  type PayrollRunListQuery,
  type PayrollRunPage,
  PayrollRateSource,
  PayrollRunStatus,
  type PayslipDto,
  type PayslipIssue,
  PayslipIssueCode,
  Permission,
  sum,
  toMoneyString,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { ExpensesService } from '../expenses/expenses.service';
import { EmployeeAccessService } from '../hr/employee-access.service';
import { EmployeeLedgerService } from '../hr/employee-ledger.service';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { type ComputedRun, PayrollComputeService } from './payroll-compute.service';
import { PayrollRatesService } from './payroll-rates.service';
import { PayrollSettingsService } from './payroll-settings.service';

/** Arbitrary constant: one run created at a time per company and month. */
const RUN_LOCK_KEY = 7_120_432;
const TX_OPTIONS = { timeout: 60_000 };

const slipInclude = { lines: { orderBy: { position: 'asc' } } } as const;
type SlipRow = Prisma.PayslipGetPayload<{ include: typeof slipInclude }>;

interface LockedRun {
  id: string;
  month: string;
  warehouseId: string | null;
  status: PayrollRunStatus;
  version: number;
  number: string | null;
}

/**
 * A month's payroll (phase 31b). DRAFT is computed again at will; approving freezes it in
 * one transaction with the month lock and the employee ledgers. Nothing reopens an approved
 * run except a cancel while nothing is paid: later mistakes are régularisations.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly features: FeaturesService,
    private readonly numbering: DocumentNumberingService,
    private readonly access: EmployeeAccessService,
    private readonly ledger: EmployeeLedgerService,
    private readonly expenses: ExpensesService,
    private readonly compute: PayrollComputeService,
    private readonly settings: PayrollSettingsService,
    private readonly rates: PayrollRatesService,
  ) {}

  async list(query: PayrollRunListQuery, user: CurrentUserInfo): Promise<PayrollRunPage> {
    const db = this.prisma.db;
    const rows = await db.payrollRun.findMany({
      where: await this.reachWhere(user),
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { warehouse: { select: { id: true, name: true } }, rateSet: true },
    });
    const page = rows.slice(0, query.limit);
    const items = await this.prisma.db.$transaction((tx) => this.toDtos(tx, page));
    return { items, nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
  }

  async get(id: string, user: CurrentUserInfo): Promise<PayrollRunDetailDto> {
    return this.prisma.db.$transaction((tx) => this.detail(tx, id, user), TX_OPTIONS);
  }

  async create(input: CreatePayrollRunInput, user: CurrentUserInfo): Promise<PayrollRunDetailDto> {
    requirePermission(user, Permission.PAYROLL_MANAGE);
    const tenantId = tenantContext.requireTenantId();
    const { features } = await this.features.of(tenantId);
    // Without dépôts as business units, a run is the company's.
    const warehouseId = features.includes(Feature.MULTI_UNIT) ? input.warehouseId : null;
    if (input.month > algiersDay().slice(0, 7)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'This month has not started', {
        field: 'month',
      });
    }
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertRunScope(tx, warehouseId, user);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(${RUN_LOCK_KEY}, hashtext(${`${tenantId}|${input.month}`}))`;
      const live = await tx.payrollRun.findFirst({
        where: {
          month: input.month,
          status: { not: PayrollRunStatus.CANCELLED },
          // A company run covers every dépôt, so it overlaps any run of the month.
          ...(warehouseId ? { OR: [{ warehouseId: null }, { warehouseId }] } : {}),
        },
        select: { id: true },
      });
      if (live) {
        throw new AppException(ErrorCode.PAYROLL_RUN_EXISTS, 'A run covers this month', {
          runId: live.id,
        });
      }
      const computed = await this.compute.compute(tx, input.month, warehouseId, null, user);
      const run = await tx.payrollRun.create({
        data: {
          tenantId,
          month: input.month,
          warehouseId,
          rateSetId: computed.rateSetId,
          fingerprint: computed.fingerprint,
          computedAt: new Date(),
          computedBy: user.id,
          createdBy: user.id,
        },
        select: { id: true },
      });
      await this.compute.write(tx, run.id, input.month, computed);
      await this.audit.log(tx, {
        action: 'PAYROLL_RUN_CREATED',
        entity: 'PayrollRun',
        entityId: run.id,
        after: { month: input.month, warehouseId },
      });
      return this.detail(tx, run.id, user, computed);
    }, TX_OPTIONS);
  }

  async recompute(id: string, user: CurrentUserInfo): Promise<PayrollRunDetailDto> {
    requirePermission(user, Permission.PAYROLL_MANAGE);
    return this.prisma.db.$transaction(async (tx) => {
      const run = await this.lockDraft(tx, id, user);
      const computed = await this.refresh(tx, run, user);
      return this.detail(tx, id, user, computed);
    }, TX_OPTIONS);
  }

  async patch(
    id: string,
    input: PatchPayrollRunParsed,
    user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    requirePermission(user, Permission.PAYROLL_MANAGE);
    return this.prisma.db.$transaction(async (tx) => {
      const run = await this.lockDraft(tx, id, user);
      const tenantId = tenantContext.requireTenantId();
      if (input.remove.length > 0) {
        await tx.payrollManualLine.deleteMany({ where: { runId: id, id: { in: input.remove } } });
      }
      const covered = new Set(
        await this.compute.employeeIds(tx, run.month, run.warehouseId, id, user),
      );
      for (const line of input.add) {
        if (!covered.has(line.employeeId)) {
          throw new AppException(ErrorCode.NOT_FOUND, 'Employee not on this run');
        }
        await tx.payrollManualLine.create({
          data: {
            tenantId,
            runId: id,
            employeeId: line.employeeId,
            kind: line.kind,
            amount: line.amount,
            note: line.note,
            createdBy: user.id,
            ...(await this.manualFields(tx, line)),
          },
        });
      }
      await this.audit.log(tx, {
        action: 'PAYROLL_RUN_LINES_CHANGED',
        entity: 'PayrollRun',
        entityId: id,
        after: { add: input.add, remove: input.remove },
      });
      const computed = await this.refresh(tx, run, user);
      return this.detail(tx, id, user, computed);
    }, TX_OPTIONS);
  }

  /** Label and flags of a hand-entered line, frozen with it. */
  private async manualFields(tx: Tx, line: PayrollManualLineInput) {
    if (line.kind === PayrollManualKind.ITEM) {
      const type = await this.settings.liveType(tx, line.typeId);
      return {
        typeId: type.id,
        label: type.name,
        cotisable: type.cotisable,
        imposable: type.imposable,
      };
    }
    if (line.kind === PayrollManualKind.REGULARISATION) {
      return {
        label: `Régularisation : ${line.note}`.slice(0, 120),
        cotisable: line.cotisable,
        imposable: line.imposable,
      };
    }
    return { label: line.note.slice(0, 120) };
  }

  private async refresh(tx: Tx, run: LockedRun, user: CurrentUserInfo): Promise<ComputedRun> {
    const computed = await this.compute.compute(tx, run.month, run.warehouseId, run.id, user);
    await this.compute.write(tx, run.id, run.month, computed);
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        rateSetId: computed.rateSetId,
        fingerprint: computed.fingerprint,
        version: { increment: 1 },
        computedAt: new Date(),
        computedBy: user.id,
      },
    });
    return computed;
  }

  /**
   * DRAFT → APPROVED, in one transaction: figures checked against what the owner read,
   * number, month lock, ledgers, audit. The employee rows are locked first, in id order, so
   * no pointage or avance slips in between the check and the freeze.
   */
  async approve(
    id: string,
    input: ApprovePayrollRunInput,
    user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    requirePermission(user, Permission.PAYROLL_APPROVE, {
      message: 'Only the owner (or a user he allows) approves a payroll',
    });
    return this.prisma.db.$transaction(async (tx) => {
      const run = await this.lockDraft(tx, id, user);
      const stored = await tx.payrollRun.findUniqueOrThrow({
        where: { id },
        select: { fingerprint: true },
      });
      await this.access.lock(
        tx,
        await this.compute.employeeIds(tx, run.month, run.warehouseId, id, user),
      );
      const computed = await this.compute.compute(tx, run.month, run.warehouseId, id, user);
      if (input.version !== run.version || computed.fingerprint !== stored.fingerprint) {
        throw new AppException(ErrorCode.PAYROLL_STALE, 'The figures changed: read them again', {
          version: run.version,
        });
      }
      this.assertApprovable(computed);
      await this.rates.assertConfirmed(tx, computed.rateSetId);

      const tenantId = tenantContext.requireTenantId();
      const number = await this.numbering.next(tx, tenantId, DocType.PAIE);
      await tx.attendanceMonthLock.createMany({
        data: [
          { warehouseId: run.warehouseId, employeeId: null as string | null },
          ...(run.warehouseId
            ? computed.slips.map((s) => ({ warehouseId: null, employeeId: s.employee.id }))
            : []),
        ].map((lock) => ({
          ...lock,
          tenantId,
          month: run.month,
          payrollRunId: id,
          createdBy: user.id,
        })),
      });
      for (const s of computed.slips) {
        const due = money(s.result.net).minus(money(s.result.retenues));
        if (!due.isZero()) {
          await this.ledger.post(tx, {
            employeeId: s.employee.id,
            type: EmployeeLedgerType.SALARY_DUE,
            amount: toMoneyString(due.neg()),
            payrollRunId: id,
            note: number,
            userId: user.id,
          });
        }
        if (!money(s.result.advanceDeducted).isZero()) {
          await this.ledger.post(tx, {
            employeeId: s.employee.id,
            type: EmployeeLedgerType.ADVANCE_DEDUCTION,
            amount: toMoneyString(money(s.result.advanceDeducted).neg()),
            payrollRunId: id,
            note: number,
            userId: user.id,
          });
        }
      }
      await tx.payrollRun.update({
        where: { id },
        data: {
          number,
          status: PayrollRunStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'PAYROLL_RUN_APPROVED',
        entity: 'PayrollRun',
        entityId: id,
        before: { status: PayrollRunStatus.DRAFT },
        after: {
          status: PayrollRunStatus.APPROVED,
          number,
          month: run.month,
          rateSetId: computed.rateSetId,
          employees: computed.slips.length,
          netToPay: toMoneyString(sum(computed.slips.map((s) => s.result.netToPay))),
        },
      });
      return this.detail(tx, id, user, computed);
    }, TX_OPTIONS);
  }

  private assertApprovable(computed: ComputedRun): void {
    const withIssue = (code: PayslipIssueCode) =>
      computed.slips.flatMap((s) => {
        const issue = s.issues.find((i) => i.code === code);
        return issue
          ? [{ employeeId: s.employee.id, fullName: s.employee.fullName, days: issue.days }]
          : [];
      });
    const ERRORS: Record<string, ErrorCode> = {
      [PayslipIssueCode.UNMARKED_DAYS]: ErrorCode.PAYROLL_UNMARKED_DAYS,
      [PayslipIssueCode.NO_SALARY]: ErrorCode.PAYROLL_NO_SALARY,
      [PayslipIssueCode.NEGATIVE_NET]: ErrorCode.PAYROLL_NEGATIVE_NET,
    };
    for (const code of BLOCKING_PAYSLIP_ISSUES) {
      const employees = withIssue(code);
      if (employees.length > 0) {
        throw new AppException(ERRORS[code]!, 'The run cannot be approved', { employees });
      }
    }
  }

  /**
   * A draft is dropped; an approved run is undone while nothing is paid: the ledgers get
   * reversing entries, the month opens again and the number stays with the cancelled run.
   */
  async cancel(
    id: string,
    input: CancelPayrollRunInput,
    user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const run = await this.lock(tx, id, user);
      requirePermission(
        user,
        run.status === PayrollRunStatus.DRAFT
          ? Permission.PAYROLL_MANAGE
          : Permission.PAYROLL_APPROVE,
      );
      if (run.status === PayrollRunStatus.CANCELLED) {
        throw new AppException(ErrorCode.PAYROLL_RUN_STATUS, 'Already cancelled', {
          status: run.status,
        });
      }
      if (run.status === PayrollRunStatus.APPROVED) {
        const paid = await this.expenses.paidOnRuns(tx, [id]);
        if (paid.size > 0) {
          throw new AppException(ErrorCode.PAYROLL_ALREADY_PAID, 'Salaries were paid on this run');
        }
        const slips = await tx.payslip.findMany({
          where: { runId: id },
          select: { employeeId: true, net: true, retenues: true, advanceDeducted: true },
        });
        await this.access.lock(
          tx,
          slips.map((s) => s.employeeId),
        );
        for (const s of slips) {
          const due = money(s.net.toString()).minus(money(s.retenues.toString()));
          if (!due.isZero()) {
            await this.ledger.post(tx, {
              employeeId: s.employeeId,
              type: EmployeeLedgerType.SALARY_REVERSAL,
              amount: toMoneyString(due),
              payrollRunId: id,
              note: input.reason,
              userId: user.id,
            });
          }
          if (!money(s.advanceDeducted.toString()).isZero()) {
            await this.ledger.post(tx, {
              employeeId: s.employeeId,
              type: EmployeeLedgerType.ADVANCE_DEDUCTION,
              amount: toMoneyString(s.advanceDeducted.toString()),
              payrollRunId: id,
              note: input.reason,
              userId: user.id,
            });
          }
        }
        await tx.attendanceMonthLock.deleteMany({ where: { payrollRunId: id } });
      }
      await tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: user.id,
          cancelReason: input.reason,
        },
      });
      await this.audit.log(tx, {
        action: 'PAYROLL_RUN_CANCELLED',
        entity: 'PayrollRun',
        entityId: id,
        before: { status: run.status },
        after: { reason: input.reason },
      });
      return this.detail(tx, id, user);
    }, TX_OPTIONS);
  }

  /**
   * Pays the whole run or chosen employees: per employee, one dépense and one SALARY_PAID.
   * The run row stays locked, so two payments can never pass the same remaining amount.
   */
  async pay(
    id: string,
    input: PayPayrollRunInput,
    user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    requirePermission(user, Permission.PAYROLL_PAY);
    const date = input.date ?? algiersDay();
    if (date > algiersDay()) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A payment cannot be in the future', {
        field: 'date',
      });
    }
    return this.prisma.db.$transaction(async (tx) => {
      const run = await this.lock(tx, id, user);
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new AppException(ErrorCode.PAYROLL_RUN_STATUS, 'The run is not approved', {
          status: run.status,
        });
      }
      const slips = await tx.payslip.findMany({ where: { runId: id } });
      const paid = await this.expenses.paidOnRuns(tx, [id]);
      const remaining = new Map(
        slips.map((s) => [
          s.employeeId,
          money(s.netToPay.toString()).minus(money(paid.get(`${id}|${s.employeeId}`) ?? '0')),
        ]),
      );
      const wanted =
        input.items ??
        slips
          .filter((s) => remaining.get(s.employeeId)!.gt(0))
          .map((s) => ({ employeeId: s.employeeId, amount: undefined }));
      const ids = wanted.map((w) => w.employeeId);
      if (new Set(ids).size !== ids.length) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'An employee appears twice', {
          field: 'items',
        });
      }
      await this.access.lock(tx, ids);
      for (const item of [...wanted].sort((a, b) => a.employeeId.localeCompare(b.employeeId))) {
        const slip = slips.find((s) => s.employeeId === item.employeeId);
        if (!slip) throw new AppException(ErrorCode.NOT_FOUND, 'Employee not on this run');
        const left = remaining.get(item.employeeId)!;
        const amount = item.amount ? money(item.amount) : left;
        if (amount.lte(0) || amount.gt(left)) {
          throw new AppException(ErrorCode.PAYROLL_OVERPAYMENT, 'More than what remains to pay', {
            employeeId: item.employeeId,
            remaining: toMoneyString(left),
          });
        }
        const value = toMoneyString(amount);
        const expense = await this.expenses.createEmployeePaymentInTx(
          tx,
          {
            employeeId: item.employeeId,
            employeeName: slip.fullName,
            warehouseId: slip.warehouseId,
            amount: value,
            mode: input.mode,
            date,
            reference: input.reference,
            note: `Salaire ${run.month} (${run.number})`,
            payrollRunId: id,
          },
          user,
        );
        await this.ledger.post(tx, {
          employeeId: item.employeeId,
          type: EmployeeLedgerType.SALARY_PAID,
          amount: value,
          expenseId: expense.id,
          payrollRunId: id,
          note: run.number,
          userId: user.id,
        });
        await this.audit.log(tx, {
          action: 'SALARY_PAID',
          entity: 'SalaryPayment',
          entityId: expense.id,
          after: { runId: id, employeeId: item.employeeId, amount: value, mode: input.mode },
        });
      }
      return this.detail(tx, id, user);
    }, TX_OPTIONS);
  }

  /** The run row, locked until the transaction ends. Outside his reach it is not there. */
  private async lock(tx: Tx, id: string, user: CurrentUserInfo): Promise<LockedRun> {
    const [run] = await tx.$queryRaw<LockedRun[]>`
      SELECT id, month, "warehouseId", status, version, number FROM payroll_runs
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    if (!run || !(await this.inReach(tx, run.warehouseId, user))) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Payroll run not found');
    }
    return run;
  }

  private async lockDraft(tx: Tx, id: string, user: CurrentUserInfo): Promise<LockedRun> {
    const run = await this.lock(tx, id, user);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new AppException(ErrorCode.PAYROLL_RUN_STATUS, 'The run is not a draft', {
        status: run.status,
      });
    }
    return run;
  }

  /** A company run covers every dépôt, so only someone who reaches them all sees it. */
  private async inReach(
    db: Tx,
    warehouseId: string | null,
    user: CurrentUserInfo,
  ): Promise<boolean> {
    const { warehouseIds } = await this.scope.warehouses(user, db);
    if (warehouseIds === null) return true;
    return !!warehouseId && warehouseIds.includes(warehouseId);
  }

  private async reachWhere(user: CurrentUserInfo): Promise<Prisma.PayrollRunWhereInput> {
    const { warehouseIds } = await this.scope.warehouses(user);
    return warehouseIds === null ? {} : { warehouseId: { in: warehouseIds } };
  }

  private async assertRunScope(
    tx: Tx,
    warehouseId: string | null,
    user: CurrentUserInfo,
  ): Promise<void> {
    if (!(await this.inReach(tx, warehouseId, user))) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Warehouse not found');
    }
    if (!warehouseId) return;
    const found = await tx.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null, type: { not: WarehouseType.VEHICLE } },
      select: { id: true },
    });
    if (!found) throw new AppException(ErrorCode.NOT_FOUND, 'Warehouse not found');
  }

  private async detail(
    tx: Tx,
    id: string,
    user: CurrentUserInfo,
    computed?: ComputedRun,
  ): Promise<PayrollRunDetailDto> {
    const run = await tx.payrollRun.findFirst({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true } },
        rateSet: true,
        manualLines: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run || !(await this.inReach(tx, run.warehouseId, user))) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Payroll run not found');
    }
    const [[dto], slips, paid] = await Promise.all([
      this.toDtos(tx, [run]),
      tx.payslip.findMany({
        where: { runId: id },
        orderBy: { fullName: 'asc' },
        include: slipInclude,
      }),
      this.expenses.paidOnRuns(tx, [id]),
    ]);
    const live = run.status === PayrollRunStatus.DRAFT;
    const { from, to } = monthBounds(run.month);
    const fresh =
      computed ??
      (live ? await this.compute.compute(tx, run.month, run.warehouseId, id, user) : undefined);
    return {
      ...dto!,
      payslips: slips.map((s) => toPayslipDto(s, paid.get(`${id}|${s.employeeId}`) ?? '0')),
      manualLines: run.manualLines.map((m) => ({
        id: m.id,
        employeeId: m.employeeId,
        kind: m.kind,
        label: m.label,
        amount: toMoneyString(m.amount.toString()),
        note: m.note,
      })),
      incentivesWithoutEmployee: fresh?.incentivesWithoutEmployee ?? [],
      manualSalaryExpenses: await this.expenses.manualSalaryTotal(tx, from, to),
    };
  }

  private async toDtos(
    tx: Tx,
    runs: (Prisma.PayrollRunGetPayload<object> & {
      warehouse: { id: string; name: string } | null;
      rateSet: { id: string; tenantId: string | null; toVerify: boolean };
    })[],
  ): Promise<PayrollRunDto[]> {
    const ids = runs.map((r) => r.id);
    const [totals, paid, confirmed] = await Promise.all([
      tx.payslip.groupBy({
        by: ['runId'],
        where: { runId: { in: ids } },
        _count: { _all: true },
        _sum: {
          gross: true,
          cnasEmployee: true,
          cnasEmployer: true,
          irg: true,
          net: true,
          netToPay: true,
          employerCost: true,
        },
      }),
      this.expenses.paidOnRuns(tx, ids),
      this.rates.confirmedIds(
        tx,
        runs.map((r) => r.rateSet.id),
      ),
    ]);
    const byRun = new Map(totals.map((t) => [t.runId, t]));
    return runs.map((r) => {
      const t = byRun.get(r.id);
      const figure = (v: { toString(): string } | null | undefined) =>
        toMoneyString(v?.toString() ?? '0');
      const runPaid = sum(
        [...paid.entries()].filter(([k]) => k.startsWith(`${r.id}|`)).map(([, v]) => v),
      );
      const netToPay = money(figure(t?._sum.netToPay));
      const approved = r.status === PayrollRunStatus.APPROVED;
      return {
        id: r.id,
        number: r.number,
        month: r.month,
        warehouse: r.warehouse,
        status: r.status,
        version: r.version,
        rateSetId: r.rateSet.id,
        rateSetSource:
          r.rateSet.tenantId === null ? PayrollRateSource.PLATFORM : PayrollRateSource.COMPANY,
        rateSetToVerify: r.rateSet.tenantId === null && r.rateSet.toVerify,
        ratesConfirmed: confirmed.has(r.rateSet.id),
        employeeCount: t?._count._all ?? 0,
        totals: {
          gross: figure(t?._sum.gross),
          cnasEmployee: figure(t?._sum.cnasEmployee),
          cnasEmployer: figure(t?._sum.cnasEmployer),
          irg: figure(t?._sum.irg),
          net: figure(t?._sum.net),
          netToPay: netToPay.toFixed(2),
          employerCost: figure(t?._sum.employerCost),
          paid: toMoneyString(runPaid),
          remaining: approved ? toMoneyString(netToPay.minus(runPaid)) : '0.00',
        },
        computedAt: r.computedAt.toISOString(),
        approvedAt: r.approvedAt?.toISOString() ?? null,
        cancelReason: r.cancelReason,
      };
    });
  }
}

export function toPayslipDto(s: SlipRow, paid: string): PayslipDto {
  const m = (v: { toString(): string }) => toMoneyString(v.toString());
  return {
    id: s.id,
    runId: s.runId,
    month: s.month,
    employeeId: s.employeeId,
    fullName: s.fullName,
    matricule: s.matricule,
    position: s.position,
    nss: s.nss,
    declared: s.declared,
    payType: s.payType,
    salary: m(s.salary),
    days: s.days as unknown as PayDaySummary,
    issues: s.issues as unknown as PayslipIssue[],
    irgDetail: s.irgDetail as unknown as IrgDetail,
    gross: m(s.gross),
    cotisable: m(s.cotisable),
    cnasEmployee: m(s.cnasEmployee),
    cnasEmployer: m(s.cnasEmployer),
    taxable: m(s.taxable),
    irg: m(s.irg),
    net: m(s.net),
    retenues: m(s.retenues),
    advanceDeducted: m(s.advanceDeducted),
    advanceCarried: m(s.advanceCarried),
    netToPay: m(s.netToPay),
    employerCost: m(s.employerCost),
    cumulGross: m(s.cumulGross),
    cumulIrg: m(s.cumulIrg),
    paid: toMoneyString(paid),
    remaining: toMoneyString(money(s.netToPay.toString()).minus(money(paid))),
    lines: s.lines.map((l) => ({
      code: l.code as PayLineCode,
      label: l.label,
      quantity: l.quantity?.toString() ?? null,
      base: l.base ? m(l.base) : null,
      rate: l.rate?.toString() ?? null,
      amount: m(l.amount),
      cotisable: l.cotisable,
      imposable: l.imposable,
    })),
  };
}
