import ExcelJS from 'exceljs';
import type { OverviewDto, OverviewFigures } from '@erp/shared';

export function overviewFileName(report: OverviewDto): string {
  return `vue-ensemble-${report.from}-${report.to}.xlsx`;
}

/**
 * Fixed French column titles, like the other exports. Columns hidden on the screen
 * (margin, stock value, charges) are left empty, never shown.
 */
const COLUMNS: { title: string; value: (f: OverviewFigures) => string | number | null }[] = [
  { title: "Chiffre d'affaires TTC", value: (f) => f.sales.ttc },
  { title: 'Ventes', value: (f) => f.sales.count },
  { title: 'Période précédente TTC', value: (f) => f.sales.previousTtc },
  { title: 'Évolution %', value: (f) => f.sales.changePct },
  { title: 'Encaissements', value: (f) => f.cashIn },
  { title: 'Règlements fournisseurs', value: (f) => f.cashOut.supplierPayments },
  { title: 'Dépenses payées', value: (f) => f.cashOut.expenses },
  { title: 'Trésorerie nette', value: (f) => f.netCash },
  { title: 'Marge brute', value: (f) => f.margin },
  { title: 'Charges', value: (f) => f.charges },
  { title: 'Résultat net', value: (f) => f.netResult },
  { title: 'Créances clients', value: (f) => f.credit.total },
  { title: 'Créances > 90 j', value: (f) => f.credit.over90 },
  { title: 'Créances > 90 j %', value: (f) => f.credit.over90Pct },
  { title: 'Valeur du stock', value: (f) => f.stock.value },
  { title: 'Produits sous le seuil', value: (f) => f.stock.lowStock },
  { title: 'Meilleur vendeur', value: (f) => f.topSeller?.fullName ?? null },
  { title: 'CA du meilleur vendeur', value: (f) => f.topSeller?.ttc ?? null },
];

const TEXT_COLUMNS = new Set(['Meilleur vendeur']);
const COUNT_COLUMNS = new Set(['Ventes', 'Produits sous le seuil']);

export async function buildOverviewXlsx(report: OverviewDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Vue d'ensemble");
  sheet.addRow([`Vue d'ensemble du ${report.from} au ${report.to}`]).font = { bold: true };
  sheet.addRow([`Comparée au ${report.previousFrom} – ${report.previousTo}`]);
  sheet.addRow([]);
  sheet.addRow(['Dépôt', ...COLUMNS.map((c) => c.title)]).font = { bold: true };
  // Excel cells are floats; the exact values are in the API, this is a spreadsheet copy.
  const cells = (f: OverviewFigures) =>
    COLUMNS.map((c) => {
      const v = c.value(f);
      if (v === null) return null;
      return TEXT_COLUMNS.has(c.title) ? v : Number(v);
    });
  for (const w of report.warehouses) sheet.addRow([w.warehouse.name, ...cells(w)]);
  sheet.addRow(['Total', ...cells(report.total)]).font = { bold: true };
  sheet.getColumn(1).width = 28;
  COLUMNS.forEach((c, i) => {
    const col = sheet.getColumn(i + 2);
    col.width = 18;
    if (!TEXT_COLUMNS.has(c.title)) {
      col.numFmt = COUNT_COLUMNS.has(c.title) ? '0' : c.title.endsWith('%') ? '0.0' : '#,##0.00';
    }
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
