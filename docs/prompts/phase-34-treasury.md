Read AGENTS.md, docs/domain.md (Money, Suppliers, Charges, Vue d'ensemble) and docs/architecture.md before doing anything. Read `apps/api/src/payments/payments.service.ts`, `apps/api/src/purchases/supplier-payments.service.ts`, `apps/api/src/purchases/purchase-workflow.service.ts` (paid at reception), `apps/api/src/import-files/import-files.service.ts` (`createCost`), `apps/api/src/expenses/expenses.service.ts` and `apps/api/src/reports/overview.service.ts`.

## Task: Phase 34 — Trésorerie: caisses, comptes bancaires, soldes

Branch: `phase-34-treasury`. Phases 1–32 are merged (33 is reserved). Feature flag: new `TREASURY`, in **every** edition (every grossiste asks "combien j'ai en caisse ?").

### Why (gaps found on 2026-11-06, see `docs/guide-workflow-ar.md` §10)
1. There is no caisse or bank account and no cash balance: money rows only carry a mode (espèces / chèque / virement) and a dépôt. The overview's *solde de trésorerie* is cash in − cash out of a period, not what is in the till.
2. `Purchase.paidAmount` (paid at reception) only writes a supplier ledger `PAYMENT`. It is not a `SupplierPayment`, so it has no mode or dépôt and is missing from the overview's cash out.
3. An import cost without a supplier (douane paid at the port) goes into the landed cost but never appears as money out.

### Domain rules
- **CashAccount** (master data, soft delete): name, type `CAISSE` | `BANQUE` | `CCP`, dépôt (optional; required for `CAISSE` when `MULTI_UNIT` is on), bank name and RIB for a bank, `isDefault` per type and dépôt, currency `DZD` (foreign accounts are parked). Seeded per tenant on first use: one *Caisse principale* (on the dépôt principal) and one *Banque principale*.
- **Cash ledger** (`CashMovement`, append-only like the other ledgers, DB trigger): account, signed `amount` `Decimal(14,2)` (+ in, − out), type `OPENING` | `VERSEMENT` | `SUPPLIER_PAYMENT` | `EXPENSE` | `TRANSFER_OUT` | `TRANSFER_IN` | `COUNT_ADJUST` | `REVERSAL`, `refType` / `refId`, date, user, note. The balance is cached in `CashAccountBalance`, updated in the same transaction and reconcilable (`GET /treasury/reconcile`, added to the existing reconcile job).
- **Every money row gets a `cashAccountId`** (nullable at first, expand → backfill → contract in a later release): `Payment`, `SupplierPayment`, `Expense` (avances and salary payments included). Writing one of them writes its `CashMovement` in the same transaction. Cancelling one writes a `REVERSAL`. A bounced client cheque writes a `REVERSAL` on the account it went into.
- **Default account** when none is given: mode `ESPECES` → the default caisse of the row's dépôt (else the caisse principale); `CHEQUE` / `VIREMENT` → the default bank. The user can pick another account in their reach (phase 24 scope: an account on a dépôt is reached like the dépôt; an account with no dépôt is managers only).
- **Paid at reception becomes a real règlement**: validating a BR with `paidAmount > 0` now creates a `SupplierPayment` (`RGF`, mode and account asked on the BR form, the BR's dépôt) in the same transaction, instead of the bare ledger entry. Its supplier ledger effect is unchanged (one `PAYMENT` entry, now with `refType` `SupplierPayment`). Older BRs are not rewritten: the backfill reports them (count, total) so the owner can enter an opening balance that already accounts for them.
- **Import cost paid now**: an import cost without a supplier may be marked *payé* with a mode and an account. That writes a `CashMovement` of type `IMPORT_COST` (add it to the enum) with `refType` `ImportCost`, and no `Expense`. It never enters the charges report (the cost is already in the CUMP). Cancelling the cost reverses it. A cost with a supplier stays as today: it is paid with a règlement.
- **Transfers** (`TRF-YYYY-000001`, new `DocType`): from one account to another (versement de la caisse en banque, retrait), one transaction, two movements. Idempotent. Not income, not a charge: left out of cash in / cash out totals.
- **Opening balance**: one `OPENING` per account, at a date chosen by the owner (`TREASURY_MANAGE`). Movements dated before it are not counted in the balance (the backfill links old rows to accounts but the opening carries their result).
- **Comptage de caisse** (cash count): the user enters what he counts; the écart against the balance is written as `COUNT_ADJUST` with a required reason, audited, owner alert above a tenant threshold. No open/close sessions in this phase.
- Money is never a float; every POST that moves money is idempotent; audit on every write.

### API
- CRUD `cash-accounts` (archive instead of delete; refuse archiving a non-zero balance).
- `GET /cash-accounts/:id/movements` (cursor, dates) with running balance; `GET /treasury/summary?date=` (balance per account and per dépôt, cash in / out of the day).
- `POST /treasury/transfers`, `POST /treasury/transfers/:id/cancel`, `POST /cash-accounts/:id/opening`, `POST /cash-accounts/:id/counts`.
- `cashAccountId` (optional) on the versement, règlement fournisseur, dépense, avance, salary payment and BR (`paidAmount`) inputs; `paid` + `mode` + `cashAccountId` on import cost input.
- Overview and dashboard: add *solde des caisses* and *solde des banques* (managers, reached dépôts); `cashOut.supplierPayments` now includes paid-at-reception RGFs (they are RGFs); add `cashOut.importCosts`.
- Backfill CLI (`pnpm --filter @erp/api treasury:backfill`): links existing rows to the default accounts by the rule above, writes their movements dated at the row's date, idempotent (second run: 0 changes), prints the paid-at-reception BRs it could not turn into RGFs.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- *Trésorerie* page: one card per account (balance, today's in / out), movements list, buttons Transfert, Comptage, Solde initial.
- An account picker (prefilled with the default) on the versement, règlement, dépense, avance, salary payment, BR and import cost forms; hidden when the tenant has one account per type.
- Dashboard card *En caisse* with the balances.
- All strings in ar / fr / en; update `docs/guide-workflow-ar.md` §5 and §10 to the new behaviour.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: default account choice, balance from movements, count écart, transfer pair sums to zero.
- Integration: versement / RGF / dépense / avance / salary payment each write one movement and their cancel reverses it; bounced cheque; BR paid at reception creates one RGF and the same supplier balance as before; import cost paid now is in cash out and not in charges; transfer idempotent replay and concurrent transfers draining one caisse keep the balance right (lock the account balance rows by id order); opening excludes earlier rows; backfill twice = 0 changes; scope by dépôt; tenant isolation (RLS policy + rls int-spec).

### Not in this phase
Sessions de caisse (open / close per cashier), per-seller caisses, foreign-currency accounts, bank statement import and rapprochement, exchange gain / loss.

### Definition of done
AGENTS.md §10. After merge: `db:deploy`, then the backfill twice, then reconcile. Summary ends with What / How to test manually / Decisions / Next phase.
