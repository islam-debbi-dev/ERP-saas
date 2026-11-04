import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  money,
  type MyPayslipDto,
  PayrollRunStatus,
  type PayslipDto,
  Permission,
  toMoneyString,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { EmployeeAccessService } from '../hr/employee-access.service';
import { PdfRendererService } from '../printing/pdf-renderer.service';
import { layout, layoutPages } from '../printing/templates/layout';
import { payslipPage } from '../printing/templates/payslip';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { PayrollRunsService, toPayslipDto } from './payroll-runs.service';
import {
  buildDas,
  buildEtatCnas,
  buildLivreDePaie,
  buildRecapIrg,
  type DasRow,
} from './payroll-xlsx';

export interface PayrollFile {
  buffer: Buffer;
  filename: string;
}

export type PayrollExport = 'livre-de-paie' | 'etat-cnas' | 'recap-irg';

const slipInclude = {
  lines: { orderBy: { position: 'asc' } },
  run: { select: { number: true, approvedAt: true, status: true, warehouseId: true } },
} as const;

/** Bulletins, reçus and the month's exports (phase 31b). Only approved runs are printed. */
@Injectable()
export class PayrollDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: PayrollRunsService,
    private readonly tenants: TenantsService,
    private readonly renderer: PdfRendererService,
    private readonly access: EmployeeAccessService,
  ) {}

  private assertApproved(status: string): void {
    if (status !== PayrollRunStatus.APPROVED) {
      throw new AppException(ErrorCode.PAYROLL_RUN_STATUS, 'Only an approved run is printed', {
        status,
      });
    }
  }

  private async renderSlip(
    row: NonNullable<Awaited<ReturnType<PayrollDocumentsService['findSlip']>>>,
  ): Promise<PayrollFile> {
    const seller = await this.tenants.getSettings();
    const page = payslipPage(
      toPayslipDto(row, '0'),
      {
        number: row.run.number,
        approvedAt: row.run.approvedAt?.toISOString() ?? null,
        toVerify: row.rateSetToVerify,
      },
      seller,
    );
    return {
      buffer: await this.renderer.render(layout(page), page.format, seller.documentFooter),
      filename: `paie-${row.matricule}-${row.month}.pdf`,
    };
  }

  private findSlip(id: string) {
    return this.prisma.db.payslip.findFirst({ where: { id }, include: slipInclude });
  }

  async slipPdf(id: string, user: CurrentUserInfo): Promise<PayrollFile> {
    const row = await this.findSlip(id);
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Payslip not found');
    await this.runs.get(row.runId, user);
    this.assertApproved(row.run.status);
    return this.renderSlip(row);
  }

  async runPdf(id: string, user: CurrentUserInfo): Promise<PayrollFile> {
    const run = await this.runs.get(id, user);
    this.assertApproved(run.status);
    const seller = await this.tenants.getSettings();
    const pages = run.payslips.map((s) =>
      payslipPage(
        s,
        { number: run.number, approvedAt: run.approvedAt, toVerify: run.rateSetToVerify },
        seller,
      ),
    );
    // One file, one paper size: a reçu keeps its layout on an A4 page.
    const a4 = pages.map((p) => ({ ...p, format: 'A4' as const }));
    if (a4.length === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Nobody on this run');
    }
    return {
      buffer: await this.renderer.render(layoutPages(a4), 'A4', seller.documentFooter),
      filename: `${run.number ?? 'paie'}.pdf`,
    };
  }

  async runExport(id: string, kind: PayrollExport, user: CurrentUserInfo): Promise<PayrollFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const run = await this.runs.get(id, user);
    this.assertApproved(run.status);
    const label = `${run.month}${run.warehouse ? ` — ${run.warehouse.name}` : ''}`;
    const slips: PayslipDto[] = run.payslips;
    const buffer = await (kind === 'livre-de-paie'
      ? buildLivreDePaie(label, slips)
      : kind === 'etat-cnas'
        ? buildEtatCnas(label, slips)
        : buildRecapIrg(label, slips));
    return { buffer, filename: `${kind}-${run.month}.xlsx` };
  }

  /** Per declared employee, over the approved runs of a year the user reaches. */
  async das(year: string, user: CurrentUserInfo): Promise<PayrollFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const reach = await this.access.where(user, 'operate', undefined);
    const rows = await this.prisma.db.payslip.findMany({
      where: {
        month: { gte: `${year}-01`, lte: `${year}-12` },
        declared: true,
        run: { status: PayrollRunStatus.APPROVED },
        employee: reach,
      },
      orderBy: [{ fullName: 'asc' }, { month: 'asc' }],
    });
    const byEmployee = new Map<string, DasRow>();
    const add = (a: string, b: { toString(): string }) =>
      toMoneyString(money(a).add(money(b.toString())));
    for (const r of rows) {
      const seen = byEmployee.get(r.employeeId) ?? {
        matricule: r.matricule,
        nss: r.nss,
        fullName: r.fullName,
        gross: '0',
        cotisable: '0',
        cnasEmployee: '0',
        taxable: '0',
        irg: '0',
        net: '0',
      };
      byEmployee.set(r.employeeId, {
        ...seen,
        gross: add(seen.gross, r.gross),
        cotisable: add(seen.cotisable, r.cotisable),
        cnasEmployee: add(seen.cnasEmployee, r.cnasEmployee),
        taxable: add(seen.taxable, r.taxable),
        irg: add(seen.irg, r.irg),
        net: add(seen.net, r.net),
      });
    }
    return {
      buffer: await buildDas(year, [...byEmployee.values()]),
      filename: `das-${year}.xlsx`,
    };
  }

  /** The signed-in worker's own approved payslips. */
  async mine(user: CurrentUserInfo): Promise<MyPayslipDto[]> {
    const { id } = await this.access.own(this.prisma.db, user);
    const rows = await this.prisma.db.payslip.findMany({
      where: { employeeId: id, run: { status: PayrollRunStatus.APPROVED } },
      orderBy: { month: 'desc' },
      include: { run: { select: { number: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      month: r.month,
      number: r.run.number,
      declared: r.declared,
      netToPay: toMoneyString(r.netToPay.toString()),
    }));
  }

  async minePdf(id: string, user: CurrentUserInfo): Promise<PayrollFile> {
    const own = await this.access.own(this.prisma.db, user);
    const row = await this.findSlip(id);
    // Someone else's payslip is not there, not forbidden.
    if (!row || row.employeeId !== own.id || row.run.status !== PayrollRunStatus.APPROVED) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Payslip not found');
    }
    return this.renderSlip(row);
  }
}
