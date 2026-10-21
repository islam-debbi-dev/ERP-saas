import ExcelJS from 'exceljs';
import type { ReportColumn, ReportDto, ReportName } from '@erp/shared';

/** French titles, like the printed documents. */
const REPORT_TITLES: Record<ReportName, string> = {
  sales: 'Ventes',
  margin: 'Marge',
  'stock-movements': 'Mouvements de stock',
  payments: 'Encaissements',
  purchases: 'Achats',
};

const COLUMN_TITLES: Record<string, string> = {
  day: 'Jour',
  month: 'Mois',
  code: 'Code',
  name: 'Client',
  user: 'Utilisateur',
  reference: 'Référence',
  designation: 'Désignation',
  unit: 'Unité',
  category: 'Catégorie',
  supplier: 'Fournisseur',
  mode: 'Mode',
  type: 'Type',
  count: 'Nombre',
  products: 'Produits',
  qty: 'Quantité',
  qtyIn: 'Entrées',
  qtyOut: 'Sorties',
  qtyNet: 'Solde',
  grossHt: 'Ventes HT',
  returnsHt: 'Avoirs HT',
  netHt: 'Net HT',
  netTtc: 'Net TTC',
  cost: 'Coût',
  margin: 'Marge',
  marginPct: 'Marge %',
  total: 'Montant',
};

const PURCHASE_TITLES: Record<string, string> = {
  grossHt: 'Achats HT',
  returnsHt: 'Retours HT',
};

const ENUM_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  CHEQUE: 'Chèque',
  VIREMENT: 'Virement',
  OPENING: 'Stock initial',
  PURCHASE: 'Achat',
  PURCHASE_RETURN: 'Retour fournisseur',
  SALE: 'Vente',
  SALE_RETURN: 'Retour client',
  ADJUSTMENT: 'Ajustement',
  INVENTORY: 'Inventaire',
};

const NONE_LABELS: Record<string, string> = {
  name: 'Client comptoir',
  category: 'Sans catégorie',
  user: '—',
};

function title(report: ReportName, c: ReportColumn): string {
  return (
    (report === 'purchases' ? PURCHASE_TITLES[c.key] : undefined) ?? COLUMN_TITLES[c.key] ?? c.key
  );
}

function cell(c: ReportColumn, value: string | null): string | number | null {
  if (value === null) return NONE_LABELS[c.key] ?? null;
  switch (c.kind) {
    // Excel cells are floats; the exact value is in the API, this is a spreadsheet copy.
    case 'money':
    case 'qty':
    case 'count':
    case 'percent':
      return Number(value);
    case 'enum':
      return ENUM_LABELS[value] ?? value;
    default:
      return value;
  }
}

const NUMBER_FORMATS: Partial<Record<ReportColumn['kind'], string>> = {
  money: '#,##0.00',
  percent: '0.00',
  qty: '#,##0.###',
  count: '0',
};

export function reportFileName(report: ReportDto): string {
  return `${report.name}-${report.groupBy}-${report.from}-${report.to}.xlsx`;
}

/** One sheet: a title line, the column headers, the rows and a totals line. */
export async function buildReportXlsx(report: ReportDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(REPORT_TITLES[report.name]);
  sheet.addRow([`${REPORT_TITLES[report.name]} du ${report.from} au ${report.to}`]).font = {
    bold: true,
  };
  sheet.addRow([]);
  const header = sheet.addRow(report.columns.map((c) => title(report.name, c)));
  header.font = { bold: true };
  for (const r of report.rows) {
    sheet.addRow(report.columns.map((c) => cell(c, r.values[c.key] ?? null)));
  }
  const totals = sheet.addRow(
    report.columns.map((c, i) => {
      const v = report.totals[c.key];
      if (v !== undefined) return cell(c, v);
      return i === 0 ? 'Total' : null;
    }),
  );
  totals.font = { bold: true };
  report.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.kind === 'text' ? 28 : 16;
    const format = NUMBER_FORMATS[c.kind];
    if (format) column.numFmt = format;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
