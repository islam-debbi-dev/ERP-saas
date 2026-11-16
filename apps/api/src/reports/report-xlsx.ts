import ExcelJS from 'exceljs';
import type { ReportColumn, ReportColumnKey, ReportDto, ReportName } from '@erp/shared';

/** French titles, like the printed documents. */
const REPORT_TITLES: Record<ReportName, string> = {
  sales: 'Ventes',
  margin: 'Marge',
  'stock-movements': 'Mouvements de stock',
  payments: 'Encaissements',
  purchases: 'Achats',
};

const COLUMN_TITLES: Record<ReportColumnKey, string> = {
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
  brand: 'Marque',
  sector: 'Secteur',
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
  ecart: 'Écart de coût',
  margin: 'Marge',
  marginPct: 'Marge %',
  total: 'Montant',
};

const PURCHASE_TITLES: Partial<Record<ReportColumnKey, string>> = {
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

const NONE_LABELS: Partial<Record<ReportColumnKey, string>> = {
  name: 'Client comptoir',
  category: 'Sans catégorie',
  user: '—',
};

function title(report: ReportName, c: ReportColumn): string {
  return (report === 'purchases' ? PURCHASE_TITLES[c.key] : undefined) ?? COLUMN_TITLES[c.key];
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

/** How a column of an exported table is printed. */
export type XlsxKind =
  | ReportColumn['kind']
  /** Tonnes, 3 decimals. */
  | 'tonne'
  /** A rate in percent, 1 decimal. */
  | 'rate'
  /** A plain ratio, 2 decimals. */
  | 'ratio';

const NUMBER_FORMATS: Partial<Record<XlsxKind, string>> = {
  money: '#,##0.00',
  percent: '0.00',
  qty: '#,##0.###',
  count: '0',
  tonne: '0.000',
  rate: '0.0',
  ratio: '0.00',
};

export function reportFileName(report: ReportDto): string {
  return `${report.name}-${report.groupBy}-${report.from}-${report.to}.xlsx`;
}

export interface XlsxTable {
  sheet: string;
  /** The line above the table: what it is and its period. */
  title: string;
  columns: { title: string; kind: XlsxKind }[];
  rows: (string | number | null)[][];
  /** A bold last line. */
  totals?: (string | number | null)[];
}

/**
 * One sheet: a title line, the column headers, the rows and an optional totals line.
 * Numbers are written as numbers, with a format per column. Shared by the reports and
 * the distribution statistics (phase 37).
 */
export async function buildTableXlsx(table: XlsxTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.sheet);
  sheet.addRow([table.title]).font = { bold: true };
  sheet.addRow([]);
  sheet.addRow(table.columns.map((c) => c.title)).font = { bold: true };
  for (const r of table.rows) sheet.addRow(r);
  if (table.totals) sheet.addRow(table.totals).font = { bold: true };
  table.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.kind === 'text' ? 28 : 16;
    const format = NUMBER_FORMATS[c.kind];
    if (format) column.numFmt = format;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** One sheet: a title line, the column headers, the rows and a totals line. */
export function buildReportXlsx(report: ReportDto): Promise<Buffer> {
  return buildTableXlsx({
    sheet: REPORT_TITLES[report.name],
    title: `${REPORT_TITLES[report.name]} du ${report.from} au ${report.to}`,
    columns: report.columns.map((c) => ({ title: title(report.name, c), kind: c.kind })),
    rows: report.rows.map((r) => report.columns.map((c) => cell(c, r.values[c.key] ?? null))),
    totals: report.columns.map((c, i) => {
      const v = report.totals[c.key];
      if (v !== undefined) return cell(c, v);
      return i === 0 ? 'Total' : null;
    }),
  });
}
