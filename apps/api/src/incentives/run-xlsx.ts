import ExcelJS from 'exceljs';
import type { IncentiveRunDetailDto } from '@erp/shared';

const ROLE_TITLES: Record<string, string> = {
  OWNER: 'Gérant',
  MANAGER: 'Manager',
  SELLER: 'Vendeur',
  STOREKEEPER: 'Magasinier',
  SUPERVISOR: 'Superviseur',
  LIVREUR: 'Livreur',
};

export function runFileName(run: IncentiveRunDetailDto): string {
  const name = run.planName
    .normalize('NFD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `primes-${name || 'plan'}-${run.period}.xlsx`;
}

/**
 * For payroll: one row per user, one column per rule, and the total. French headers,
 * like the other exports. The software computes the bonuses; payroll is done elsewhere.
 */
export async function buildRunXlsx(run: IncentiveRunDetailDto): Promise<Buffer> {
  const rules = [
    ...new Map(run.users.flatMap((u) => u.lines.map((l) => [l.ruleId, l.ruleName] as const))),
  ];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Primes');
  sheet.addRow([`Primes ${run.planName} (v${run.planVersion}) — ${run.period}`]).font = {
    bold: true,
  };
  sheet.addRow([
    `Approuvé le ${run.approvedAt?.slice(0, 10) ?? ''} par ${run.approvedBy?.fullName ?? ''}`,
  ]);
  sheet.addRow([]);
  sheet.addRow(['Nom', 'Rôle', ...rules.map(([, name]) => name), 'Total']).font = { bold: true };
  // Excel cells are floats; the exact amounts are in the API, this is a spreadsheet copy.
  for (const u of run.users) {
    sheet.addRow([
      u.user.fullName,
      ROLE_TITLES[u.user.role] ?? u.user.role,
      ...rules.map(([id]) => Number(u.lines.find((l) => l.ruleId === id)?.amount ?? 0)),
      Number(u.total),
    ]);
  }
  sheet.addRow(['Total', null, ...rules.map(() => null), Number(run.total)]).font = { bold: true };
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 14;
  for (let i = 3; i <= rules.length + 3; i++) {
    sheet.getColumn(i).width = 18;
    sheet.getColumn(i).numFmt = '#,##0.00';
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
