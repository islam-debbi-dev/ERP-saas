import ExcelJS from 'exceljs';
import { money, type PayslipDto, sum } from '@erp/shared';

/** Fixed French titles: never rename or reorder them, only add at the end. */
export const LIVRE_DE_PAIE_COLUMNS = [
  'Matricule',
  'Nom',
  'Poste',
  'Déclaré',
  'Jours de présence',
  'Salaire de base',
  'Brut',
  'Brut cotisable',
  'CNAS salarié',
  'CNAS employeur',
  'Imposable',
  'IRG',
  'Net',
  'Retenues',
  'Avances',
  'Net à payer',
] as const;
export const ETAT_CNAS_COLUMNS = [
  'NSS',
  'Nom',
  'Brut cotisable',
  'Part salarié',
  'Part employeur',
  'Total',
] as const;
export const RECAP_IRG_COLUMNS = ['Matricule', 'Nom', 'Imposable', 'IRG'] as const;
export const DAS_COLUMNS = [
  'Matricule',
  'NSS',
  'Nom',
  'Brut annuel',
  'Brut cotisable',
  'CNAS salarié',
  'Imposable',
  'IRG',
  'Net',
] as const;

const n = (value: string): number => {
  // Excel only takes numbers; the value is already rounded to the centime and stops here.
  return money(value).toNumber();
};

async function sheet(
  name: string,
  title: string,
  columns: readonly string[],
  rows: (string | number | null)[][],
  totals?: (string | number | null)[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(name);
  ws.addRow([title]).font = { bold: true };
  ws.addRow([]);
  ws.addRow([...columns]).font = { bold: true };
  for (const row of rows) ws.addRow(row);
  if (totals) ws.addRow(totals).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 16;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const total = (slips: readonly PayslipDto[], pick: (s: PayslipDto) => string) =>
  n(sum(slips.map(pick)).toFixed(2));

export function buildLivreDePaie(label: string, slips: readonly PayslipDto[]): Promise<Buffer> {
  return sheet(
    'Livre de paie',
    `Livre de paie ${label}`,
    LIVRE_DE_PAIE_COLUMNS,
    slips.map((s) => [
      s.matricule,
      s.fullName,
      s.position,
      s.declared ? 'Oui' : 'Non',
      n(s.days.present),
      n(s.salary),
      n(s.gross),
      n(s.cotisable),
      n(s.cnasEmployee),
      n(s.cnasEmployer),
      n(s.taxable),
      n(s.irg),
      n(s.net),
      n(s.retenues),
      n(s.advanceDeducted),
      n(s.netToPay),
    ]),
    [
      'Total',
      null,
      null,
      null,
      null,
      null,
      total(slips, (s) => s.gross),
      total(slips, (s) => s.cotisable),
      total(slips, (s) => s.cnasEmployee),
      total(slips, (s) => s.cnasEmployer),
      total(slips, (s) => s.taxable),
      total(slips, (s) => s.irg),
      total(slips, (s) => s.net),
      total(slips, (s) => s.retenues),
      total(slips, (s) => s.advanceDeducted),
      total(slips, (s) => s.netToPay),
    ],
  );
}

export function buildEtatCnas(label: string, slips: readonly PayslipDto[]): Promise<Buffer> {
  const declared = slips.filter((s) => s.declared);
  return sheet(
    'État CNAS',
    `État CNAS ${label}`,
    ETAT_CNAS_COLUMNS,
    declared.map((s) => [
      s.nss,
      s.fullName,
      n(s.cotisable),
      n(s.cnasEmployee),
      n(s.cnasEmployer),
      n(money(s.cnasEmployee).add(money(s.cnasEmployer)).toFixed(2)),
    ]),
    [
      'Total',
      null,
      total(declared, (s) => s.cotisable),
      total(declared, (s) => s.cnasEmployee),
      total(declared, (s) => s.cnasEmployer),
      n(sum(declared.flatMap((s) => [s.cnasEmployee, s.cnasEmployer])).toFixed(2)),
    ],
  );
}

export function buildRecapIrg(label: string, slips: readonly PayslipDto[]): Promise<Buffer> {
  const declared = slips.filter((s) => s.declared);
  return sheet(
    'Récapitulatif IRG',
    `Récapitulatif IRG ${label}`,
    RECAP_IRG_COLUMNS,
    declared.map((s) => [s.matricule, s.fullName, n(s.taxable), n(s.irg)]),
    ['Total', null, total(declared, (s) => s.taxable), total(declared, (s) => s.irg)],
  );
}

export interface DasRow {
  matricule: string;
  nss: string | null;
  fullName: string;
  gross: string;
  cotisable: string;
  cnasEmployee: string;
  taxable: string;
  irg: string;
  net: string;
}

export function buildDas(year: string, rows: readonly DasRow[]): Promise<Buffer> {
  return sheet(
    'DAS',
    `Déclaration annuelle des salaires ${year}`,
    DAS_COLUMNS,
    rows.map((r) => [
      r.matricule,
      r.nss,
      r.fullName,
      n(r.gross),
      n(r.cotisable),
      n(r.cnasEmployee),
      n(r.taxable),
      n(r.irg),
      n(r.net),
    ]),
  );
}
