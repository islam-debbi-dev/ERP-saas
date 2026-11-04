Read AGENTS.md, docs/domain.md (Charges et loyers, Géolocalisation, Dépôts as business units) and docs/architecture.md before doing anything. Read `packages/shared/src/permissions.ts`, `packages/shared/src/periods.ts`, `packages/shared/src/geo.ts`, `apps/api/src/expenses`, `apps/api/src/geo/geo-check.service.ts` and `apps/api/src/sales-force/scope.service.ts`.

## Task: Phase 31 — DRH part 1: personnel, pointage (présent / absent), congés, avances

Branch: `phase-31-hr-attendance`. Needs phases 1–26 (24 for dépôt scope, 25 for dépenses); 27–30 are not required. Feature flag: new `HR` (editions DISTRIBUTION and ENTREPRISE, grantable per tenant to the others). Dépôt-level parts only show with `MULTI_UNIT`. Payroll (bulletin de paie, CNAS, IRG) is phase 31b: this phase stores everything it needs.

The need: the owner knows every day who came to work, who was absent and why, how many congé days each worker has left, and how much each one already took as avance, without a paper notebook. Most workers have **no** app account.

### Domain rules
- **Employé** (master data, soft delete): name, phone, poste, dépôt (phase 24; optional without `MULTI_UNIT`), optional `userId` (a seller or livreur who has an account; one employee per user), hire date, exit date, contract `CDI` / `CDD` (end date) / `JOURNALIER`, pay type `MONTHLY` (salaire de base) or `DAILY` (salaire journalier), `declared` (CNAS: yes / no; many small grossistes have undeclared workers, the app must not refuse them), NSS, NIN, date of birth, RIB / CCP, weekly rest days override. Matricule `EMP-000001` per tenant (not per year).
- **Salary is never edited in place.** `EmployeeSalary` rows (amount, `effectiveFrom`, reason, who) are append-only; the salary of a day is the last row on or before it. Same for the pay type. A past month never changes when a salary goes up.
- **Calendar** (tenant settings): weekly rest days (default Friday; Friday + Saturday allowed), daily hours (default 8), and `PublicHoliday` rows by date. Seed the fixed Algerian fêtes légales (1 Jan, 12 Jan Yennayer, 1 May, 5 Jul, 1 Nov) every year; the lunar ones (Aïd el Fitr, Aïd el Adha, Awal Moharram, Achoura, Mawlid) are entered by the tenant each year with a reminder on the screen, because their dates move.
- **Pointage = append-only events.** `AttendanceEvent` (employee, Algiers day, kind, time, source, who, note): kinds `PRESENT`, `ABSENT`, `HALF_DAY`, `LATE` (minutes), `CHECK_IN`, `CHECK_OUT`, `OVERTIME` (hours), `CORRECTION`. Sources `MANAGER` (marked from the "Pointage du jour" screen), `SELF` (the employee's own phone, if he has an account), `IMPORT`. A mistake is fixed by a new event that replaces the day's status (reason required, `ATTENDANCE_CORRECT`), never by an update. Audited.
- **Day status is derived** (`packages/shared/src/attendance.ts`, pure, unit-tested): from the day's last effective events, the employee's leaves, rest days and holidays → `PRESENT`, `ABSENT_UNJUSTIFIED`, `ABSENT_JUSTIFIED` (authorised, unpaid), `SICK` (arrêt maladie), `LEAVE_PAID`, `LEAVE_UNPAID`, `HALF_DAY`, `REST`, `HOLIDAY`, `NOT_EMPLOYED` (before hire / after exit), `UNMARKED`. Cache it in `AttendanceDay` in the same transaction as the event, reconcilable from the events (add it to the nightly reconcile). A day never marked stays `UNMARKED`, never silently "present".
- **Self check-in** (only users with an account and the tenant setting on): check-in / check-out from the phone with the phase 17 rules against the dépôt's GPS point (add optional `lat`, `lng`, radius to `Warehouse`). Default is flag, not block; a FAR / MOCKED check-in needs a note and is reviewed. Never continuous tracking (law 18-07): one position per tap.
- **Lock**: a day inside a month whose payroll is approved (phase 31b) cannot get new events (`PERIOD_APPROVED`, DB trigger like phase 18). Until then a manager may correct any past day.
- **Congés**: `LeaveEntry` ledger in days (`Decimal(6,1)`): `ACCRUAL` (2.5 days per month worked, posted by the month-close job, prorata for a partial month, overridable in settings), `TAKEN`, `ADJUST` (signed, note), `OPENING` (import). Balance = sum, cached, reconcilable. A leave **request** (dates, type `PAID` / `UNPAID` / `SICK` / `OTHER`, note, optional photo of the arrêt later) goes `PENDING` → `APPROVED` / `REJECTED` (`LEAVE_APPROVE`); approving posts `TAKEN` for the working days only (rest days and holidays excluded) in one transaction. Cancelling an approved leave posts the reverse entry. A paid leave beyond the balance is a warning, not a refusal.
- **Avance sur salaire**: one operation, one transaction: a phase 25 dépense (category Salaires, linked `employeeId`), an `EmployeeLedgerEntry` `ADVANCE` (debit) and the audit row. Idempotent POST, `ADVANCE_PAY` permission. Cancelled with the dépense (reversing entry). `EmployeeLedgerEntry` is the employee's account (like the supplier ledger): `ADVANCE`, `REVERSAL`, and in 31b `SALARY_DUE` / `SALARY_PAID`. Cached balance, append-only, reconciled nightly. **Avances are cash, not a charge**: the charges report must not count them (phase 31b counts the salary).
- **Permissions** (new, in the phase 24 catalog): `HR_VIEW`, `HR_MANAGE` (employees, calendar), `ATTENDANCE_MARK`, `ATTENDANCE_CORRECT`, `LEAVE_APPROVE`, `ADVANCE_PAY`, `SALARY_VIEW`. Salaries, avances and the employee ledger are **hidden** without `SALARY_VIEW` (OWNER only by default; a dépôt manager marks attendance but does not see pay). Scope: a user sees and marks only employees of the dépôts where he has OPERATE; stats access shows counts only.

### API
- CRUD `/employees` (+ `/employees/:id/salaries` append, `/employees/:id/ledger` cursor).
- `GET /attendance/day?date=&warehouseId=` (every active employee with his status and events), `POST /attendance/events` (one or many: "tout le monde présent" is one call, idempotent), `POST /attendance/check-in`, `/check-out` (self).
- `GET /attendance/month?month=&employeeId=|warehouseId=` (grid + per-employee counts: présents, absences justifiées / non, maladie, congés, retards in minutes, heures sup).
- `/leave-requests` (create, approve, reject, cancel), `GET /employees/:id/leave-balance`.
- `POST /employees/:id/advances` (idempotent), cancel through the dépense.
- Calendar settings + `/public-holidays` CRUD. Excel export of the month grid (`EXPORT_DATA`, fixed French column titles).
- Excel import of employees (phase 9 pattern, preview + validation), with opening congé balance and opening avance balance.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- **Pointage du jour** (the screen that matters): today by default, dépôt switcher, one row per employee with big tap targets Présent / Absent / ½ / Retard, "Tous présents" button, reason sheet for an absence (justifiée, maladie, non justifiée). Under 30 seconds for 15 workers on a phone.
- Month grid (employees × days, colour + letter per status, legend; on a phone one employee per card with his month counts).
- Employés list + fiche (infos, salary history if `SALARY_VIEW`, congés balance and requests, avances and balance).
- "Mon pointage" for a user linked to an employee: check-in / check-out, his month, his congé balance, request a leave.
- Dashboard card for managers with `HR_VIEW`: présents / absents today, unmarked employees.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit (`attendance.ts`): status derivation (correction wins, leave over absence, holiday on a rest day, hire mid-month, exit mid-month, unmarked), working days between two dates (rest days, holidays), congé accrual prorata, leave days taken excluding rest days and holidays.
- Integration: mark a day + idempotent replay; correction keeps the history; "tous présents" for 50 employees in one transaction; leave approval posts the right days and the balance matches the ledger; avance creates dépense + ledger entry + audit atomically, replay creates nothing, cancel reverses both; the charges report does not count avances; salary change does not alter a past month's salary lookup; a manager without `SALARY_VIEW` gets no salary field; scope by dépôt; tenant isolation (RLS policy + rls int-spec); reconcile finds a tampered `AttendanceDay`.

### Not in this phase
Payslips, CNAS / IRG, salary payment (31b); biometric / fingerprint devices and QR badges (parked); planning of shifts; recruitment; staff documents storage.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (31b Paie).
