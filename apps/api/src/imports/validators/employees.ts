import {
  type CreateEmployeeInput,
  createEmployeeSchema,
  EmployeeContract,
  type ImportFieldDef,
  type ImportMapping,
  money,
  PayType,
} from '@erp/shared';
import type { ImportTable } from '../file-reader';
import type { ValidatedRow } from './products';
import { DuplicateTracker, RowReader } from './row-reader';

export interface EmployeePlan {
  kind: 'CREATE';
  input: CreateEmployeeInput;
  openingLeave: string | null;
  openingAdvance: string | null;
}

export interface EmployeeLookups {
  /** Lowercased names already on file. */
  existing: Set<string>;
  /** Lowercased dépôt name → id. */
  warehouses: Map<string, string>;
  /** The dépôt of a row that names none: the dépôt principal with MULTI_UNIT, else none. */
  defaultWarehouseId: string | null;
}

const normalize = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const CONTRACTS: Record<string, EmployeeContract> = {
  cdi: EmployeeContract.CDI,
  cdd: EmployeeContract.CDD,
  journalier: EmployeeContract.JOURNALIER,
};
const PAY_TYPES: Record<string, PayType> = {
  mensuel: PayType.MONTHLY,
  monthly: PayType.MONTHLY,
  journalier: PayType.DAILY,
  daily: PayType.DAILY,
};
const YES = new Set(['oui', 'o', 'yes', 'y', '1', 'true']);
const NO = new Set(['non', 'n', 'no', '0', 'false', '']);

/**
 * "Personnel" (phase 31): creates employees, with their salary and opening balances. It
 * never updates: a name already on file is refused, so importing a file twice cannot
 * double a congé or avance balance.
 */
export function validateEmployees(
  table: ImportTable,
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  lookups: EmployeeLookups,
): ValidatedRow<EmployeePlan>[] {
  const names = new DuplicateTracker();
  return table.rows.map(({ rowNumber, cells }) => {
    const row = new RowReader(rowNumber, cells, mapping, fields);
    const name = row.requiredText('name', 120);
    if (name) {
      names.check(row, 'name', name);
      if (lookups.existing.has(name.toLowerCase())) row.error('name', 'employee_exists');
    }
    const hireDate = row.date('hireDate');
    if (hireDate === '') row.error('hireDate', 'required');
    const contractEndDate = row.date('contractEndDate');
    const birthDate = row.date('birthDate');

    const contract = CONTRACTS[normalize(row.text('contract') || 'cdi')];
    if (!contract) row.error('contract', 'invalid_contract');
    const payType = PAY_TYPES[normalize(row.text('payType') || 'mensuel')];
    if (!payType) row.error('payType', 'invalid_pay_type');
    const declaredText = normalize(row.text('declared'));
    if (!YES.has(declaredText) && !NO.has(declaredText)) row.error('declared', 'invalid_boolean');

    const warehouseName = row.text('warehouse');
    const warehouseId = warehouseName
      ? (lookups.warehouses.get(warehouseName.toLowerCase()) ?? null)
      : lookups.defaultWarehouseId;
    if (warehouseName && !warehouseId) row.error('warehouse', 'unknown_warehouse');

    const salary = row.number('salary', { decimals: 2 });
    const openingLeave = row.number('openingLeave', { decimals: 1, signed: true, max: '9999' });
    const openingAdvance = row.number('openingAdvance', { decimals: 2 });

    if (row.errors.length > 0 || !name || !hireDate) return { row, plan: null };
    const parsed = createEmployeeSchema.safeParse({
      fullName: name,
      phone: row.text('phone'),
      position: row.text('position'),
      warehouseId,
      hireDate,
      contract,
      contractEndDate: contractEndDate || null,
      declared: YES.has(declaredText),
      nss: row.text('nss'),
      nin: row.text('nin'),
      birthDate: birthDate || null,
      bankAccount: row.text('bankAccount'),
      ...(salary && !money(salary).isZero()
        ? { salary: { amount: salary, payType, effectiveFrom: hireDate, reason: 'Import' } }
        : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        row.error(issue.path.join('.') || undefined, 'invalid_employee', { rule: issue.message });
      }
      return { row, plan: null };
    }
    return {
      row,
      plan: {
        kind: 'CREATE',
        input: parsed.data,
        openingLeave: openingLeave && !money(openingLeave).isZero() ? openingLeave : null,
        openingAdvance: openingAdvance && !money(openingAdvance).isZero() ? openingAdvance : null,
      },
    };
  });
}
