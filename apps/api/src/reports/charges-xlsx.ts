import ExcelJS from 'exceljs';
import type { ChargesReportDto } from '@erp/shared';

export function chargesFileName(report: ChargesReportDto): string {
  return `charges-${report.from}-${report.to}.xlsx`;
}

/** Two sheets, in French like the other exports: by category, then by dépôt. */
export async function buildChargesXlsx(report: ChargesReportDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const period = `du ${report.from} au ${report.to}`;
  // Excel cells are floats; the exact values are in the API, this is a spreadsheet copy.
  const sheets: { title: string; head: string; rows: [string, string, string, string][] }[] = [
    {
      title: 'Par catégorie',
      head: 'Catégorie',
      rows: report.byCategory.map((r) => [r.category.name, r.rent, r.expenses, r.total]),
    },
    {
      title: 'Par dépôt',
      head: 'Dépôt',
      rows: report.byWarehouse.map((r) => [
        r.warehouse?.name ?? 'Sans dépôt',
        r.rent,
        r.expenses,
        r.total,
      ]),
    },
  ];
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(s.title);
    sheet.addRow([`Charges ${period}`]).font = { bold: true };
    sheet.addRow([]);
    sheet.addRow([s.head, 'Loyer (bail)', 'Dépenses', 'Total']).font = { bold: true };
    for (const [name, rent, expenses, total] of s.rows) {
      sheet.addRow([name, Number(rent), Number(expenses), Number(total)]);
    }
    sheet.addRow([
      'Total',
      Number(report.rent),
      Number(report.expenses),
      Number(report.total),
    ]).font = { bold: true };
    sheet.addRow([]);
    sheet.addRow(['Loyers payés sur la période (trésorerie, hors total)', Number(report.rentPaid)]);
    sheet.getColumn(1).width = 34;
    for (let i = 2; i <= 4; i++) {
      sheet.getColumn(i).width = 16;
      sheet.getColumn(i).numFmt = '#,##0.00';
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
