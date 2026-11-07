import { toDay } from './attendance-days.service';

/** What EMPLOYEE_UPDATED records. The RIB is left out on purpose. */
export const employeeAuditSelect = {
  fullName: true,
  phone: true,
  position: true,
  warehouseId: true,
  userId: true,
  hireDate: true,
  exitDate: true,
  contract: true,
  contractEndDate: true,
  declared: true,
  nss: true,
  nin: true,
  birthDate: true,
  restDays: true,
} as const;

type AuditField = keyof typeof employeeAuditSelect;
type AuditValue = string | number | boolean | number[] | Date | null;
export type EmployeeAuditRow = Record<AuditField, AuditValue>;

const FIELDS = Object.keys(employeeAuditSelect) as AuditField[];

const plain = (v: AuditValue) => (v instanceof Date ? toDay(v) : v);

/** Only the fields that changed, on both sides. */
export function employeeAuditDiff(
  before: EmployeeAuditRow,
  after: EmployeeAuditRow,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const field of FIELDS) {
    const from = plain(before[field]);
    const to = plain(after[field]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    diff.before[field] = from;
    diff.after[field] = to;
  }
  return diff;
}
