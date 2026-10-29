import ExcelJS from 'exceljs';
import { AGING_BUCKETS, type AgingBucket, type AgingReportDto } from '@erp/shared';

/** French, like the printed documents and the other report exports. */
const BUCKET_TITLES: Record<AgingBucket, string> = {
  d0_30: '0–30 jours',
  d31_60: '31–60 jours',
  d61_90: '61–90 jours',
  d90: 'Plus de 90 jours',
};

export function agingFileName(report: AgingReportDto): string {
  return `balance-agee-${report.kind === 'clients' ? 'clients' : 'fournisseurs'}-${report.asOf}.xlsx`;
}

/** One sheet: title, headers, one row per account and a totals line. */
export async function buildAgingXlsx(report: AgingReportDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const title = report.kind === 'clients' ? 'Balance âgée clients' : 'Balance âgée fournisseurs';
  const sheet = workbook.addWorksheet(title);
  sheet.addRow([`${title} au ${report.asOf}`]).font = { bold: true };
  sheet.addRow([]);
  sheet.addRow([
    'Code',
    report.kind === 'clients' ? 'Client' : 'Fournisseur',
    'Solde',
    ...AGING_BUCKETS.map((b) => BUCKET_TITLES[b]),
    'Jours (plus ancien)',
  ]).font = { bold: true };
  // Excel cells are floats; the exact values are in the API, this is a spreadsheet copy.
  for (const r of report.rows) {
    sheet.addRow([
      r.party.code ?? '',
      r.party.name,
      Number(r.balance),
      ...AGING_BUCKETS.map((b) => Number(r.buckets[b])),
      r.oldestDays,
    ]);
  }
  sheet.addRow([
    'Total',
    null,
    Number(report.totals.balance),
    ...AGING_BUCKETS.map((b) => Number(report.totals.buckets[b])),
    null,
  ]).font = { bold: true };
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 32;
  for (let i = 3; i <= 7; i++) {
    sheet.getColumn(i).width = 16;
    sheet.getColumn(i).numFmt = '#,##0.00';
  }
  sheet.getColumn(8).width = 18;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
