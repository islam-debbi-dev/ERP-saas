Read AGENTS.md, docs/domain.md (DRH, Paie) before doing anything. Read `apps/api/src/hr/employees.service.ts` (`update`, `addSalary`), `apps/api/src/payroll/payroll-compute.service.ts` (the `NO_SALARY` issue), `apps/web/src/components/hr/employee-dialog.tsx`, `employee-detail.tsx` and `employees-page.tsx`.

## Task: small fix after phase 31 / 31b — salary that starts after the hire date

Branch: `fix-31-salary-start`. No new feature flag (HR / PAYROLL as today). No migration expected.

### The bug (seen 2026-11-06 on the demo tenant)
An employee was created with today as hire date, so his first salary row starts today (the create dialog sends `effectiveFrom = hireDate`). The owner then moved the hire date back to 2026-10-27. Salary rows are append-only and nothing moved the first one, so October has **no salary in force on its last day**: the October run shows *Employés sans salaire* (blocking) and the owner has no idea why, because the employee page shows a salary.

Two more problems found while looking at it:
- `EMPLOYEE_UPDATED` audits only `fullName` and `warehouseId`, so a hire date change leaves no trace.
- The employees list shows *Aucun employé* when `GET /employees` fails (a 500 looks like an empty list): `employees-page.tsx` never reads the query error.

### What to build
1. **Align the first salary when the hire date moves earlier.** `PATCH /employees/:id` accepts `alignFirstSalary?: boolean`. When the new hire date is before the earliest salary row's `effectiveFrom` and the flag is true, append (in the same transaction, never edit a row) a salary row with the earliest row's `amount` and `payType`, `effectiveFrom` = the new hire date, reason `Date d'embauche avancée`, audited like any `EMPLOYEE_SALARY_ADDED`. Needs `SALARY_VIEW` (else the flag is refused with `FORBIDDEN`). Nothing happens when there is no salary row, when the earliest row already starts on or before the hire date, or when the flag is false.
   - A month already locked by an approved run is not reopened: the new row only matters for runs computed later (rows are dated, the approved payslips are frozen).
2. **Web, edit dialog:** when the hire date typed is before the first salary's date and the user has `SALARY_VIEW`, show a notice with a checkbox ticked by default: *Faire commencer le salaire de 40 000,00 DA au 27/10/2026* (amount and date filled in). Without `SALARY_VIEW`, show only a notice that the salary starts later and the owner must fix it.
3. **Web, employee page:** when the first salary starts after the hire date, show a warning in the *Historique des salaires* card with a button that opens *Nouveau salaire* prefilled with the hire date, the same amount and pay type.
4. **Payroll run:** the `NO_SALARY` issue carries the employee's first salary date when there is one (`details.salaryFrom`). The run screen says *Salaire seulement à partir du 06/11/2026* under the name, with a link to the employee page.
5. **Audit:** `EMPLOYEE_UPDATED` before/after include every field the update changed (hire date, exit date, contract, rest days, declared, warehouse, user link, name, phone, position). Keep the RIB out of the log.
6. **Employees list error:** when the list query fails, show the shared error state with a retry button instead of the empty state. Check the other HR lists (leaves, payroll runs) for the same pattern and fix them the same way.

All new strings in `apps/web/src/messages/{ar,fr,en}.json` (identical keys). Dates shown as `dd/mm/yyyy`, amounts as `40 000,00 DA`.

### Tests
- Integration (real Postgres): moving the hire date earlier with the flag appends one row and the October run then computes the prorated salary (hire 27/10, 40 000 monthly, divisor 30: not-employed share 26/31 → gross 6 451,61); without the flag nothing is appended and the run still reports `NO_SALARY` with `salaryFrom`; the flag without `SALARY_VIEW` is refused; calling it twice does not append a second row; a month locked by an approved run keeps its payslips; tenant isolation unchanged.
- Unit: the audit diff lists only changed fields and never the RIB.
- Web: the employees list renders the error state on a failed request (component test or Playwright with a mocked 500).
- Playwright mobile (`e2e/web/mobile.spec.ts`): the edit dialog with the salary notice and the employee page warning at 360 and 393 px, in `ar` and `fr`: no horizontal overflow, main action visible.

### Not in this fix
Editing or deleting salary rows (they stay append-only), moving the first salary when the hire date moves **later** (the extra days are simply *hors contrat*), any change to the payroll rules.

### Definition of done
AGENTS.md §10 (`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green on Node 22). PR summary: What / How to test manually / Decisions.
