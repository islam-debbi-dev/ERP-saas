Read AGENTS.md, docs/domain.md (Money, Documents & numbering) and docs/architecture.md before doing anything. Read `apps/api/src/purchases/supplier-payments.service.ts` (the closest existing cash-out path) and the phase 24 scope code.

## Task: Phase 25 — Charges (dépenses) and warehouse rent

Branch: `phase-25-expenses-rent`. Phases 1–24 are merged. Feature flag: new `EXPENSES`, in **every** edition (a small grossiste pays rent too). Dépôt-level parts only show when `MULTI_UNIT` is on.

The need: know the real profit of each dépôt, which means its rent (often paid for 6 or 12 months at once) and its other charges.

### Domain rules
- **Expense** (dépense): number `DEP-YYYY-000001` (new `DocType.DEP`), date, dépôt (optional without `MULTI_UNIT`), category, amount `Decimal(14,2)`, payment mode (espèces / chèque / virement), reference, payee (free text), period covered (`periodStart`, `periodEnd`, optional), note, attachment later. Status `VALID` / `CANCELLED`. Immutable once saved; a mistake is fixed by cancelling (reason required, `EXPENSE_CANCEL` permission) and entering a new one. Idempotent POST. Audited.
- **Categories**: a small tenant list seeded with Loyer, Électricité / eau, Salaires, Transport / carburant, Téléphone / internet, Autre. Master data (soft delete).
- **RentContract** (bail): dépôt, landlord (name, phone), amount, period `MONTHLY` | `QUARTERLY` | `YEARLY`, `startDate`, `endDate` (optional), note. A contract is never edited after its first payment: a new rent = close the old one (`endDate`) and open a new one, so past months keep their cost.
- **Rent cost of any period** is computed, never stored: for each day of the period inside a contract, `amount / days of that contract period` (a yearly 1 200 000 DA lease costs 1 200 000 × 31 / 365 for October). Put the function in `packages/shared/money` (decimal.js, rounding only at the end, half-up to 2 decimals). This is the **charged** cost (accrual), independent of when it was paid.
- **Rent payment** = an Expense with category Loyer linked to the contract (`rentContractId`) and its covered period. The contract shows "payé jusqu'au", the next due date and the amount due. Alert 30 days before a contract's `endDate` and when a period is due and unpaid.
- **Charges of a period** for reports = rent cost (accrual, from contracts) + other expenses by their `periodStart..periodEnd` spread by day, or by their date when no period. Rent paid as an Expense is **not** counted twice: Loyer expenses linked to a contract are cash only, the contract carries the cost.

### API
- CRUD expense categories; `POST /expenses` (idempotent), `POST /expenses/:id/cancel`, `GET /expenses` (cursor, filters: dépôt, category, dates, mode).
- CRUD `rent-contracts` (close instead of delete); `GET /rent-contracts/:id/schedule` (periods, paid / due).
- `GET /reports/charges?from=&to=&warehouseId=` → by category and by dépôt, rent split out. Excel export behind `EXPORT_DATA`.
- Scope: phase 24 rules (OPERATE to enter, stats access to see totals).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Dépenses list + fast entry dialog (amount first, category chips, today by default).
- Dépôt page: "Loyer" block (current contract, paid until, next due, pay button that prefills the expense).
- Charges report.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: rent prorata (month inside a yearly contract, leap year, contract starting mid-month, two contracts in one month, contract ended), expense period spreading, sums exact to the centime.
- Integration: create + idempotent replay; cancel; numbering without gaps under concurrency; a Loyer payment does not double the charges report; contract cannot be edited after a payment; scope by dépôt; tenant isolation (RLS policy + rls int-spec).

### Not in this phase
Payroll, supplier invoices for services, depreciation, a full cash book (parked: "sessions de caisse" in the v1.1 backlog).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (26 Vue d'ensemble multi-dépôts).
