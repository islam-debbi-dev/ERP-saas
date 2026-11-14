# Audit report 02 — ERP SaaS, whole project

**Target:** `c469e9a` (`origin/main`, phases 1–18, 20–22, 24–26, 30, 31, 31b, 34, 35), branch `test/audit-02`.
**Dates:** 2026-11-13 and 14.
**Environment:** Node 22.23 for the repo's own commands, PostgreSQL 16 (docker `erp-saas-db-1`),
its own database `erp_audit02`, the built API on `http://localhost:3003` connected as `erp_app`
(row-level security applies), the built web on `http://localhost:3005`, Chromium (Playwright).

**Progress.** The audit is five parts, one per session.

| Part | State |
|---|---|
| Baseline | done |
| A. Correctness | **done** (this report) |
| B. Security | not started |
| C. Scaling | not started |
| D. Availability | not started |
| E. The web from outside | not started |

No request of any kind was sent to production. `apps/` and `packages/` are untouched
(`git diff --stat origin/main -- apps packages` is empty).

## 1. What was audited (part A)

| Suite | File | What it covers |
|---|---|---|
| Business scenario | `e2e/api/scenario.ts` | The 17 checks of audit 01, then one chain per module added since (`e2e/api/chains/`): import with landed costs; dépôts, truck, tournée, seller session, emballages; règlements, cheques, aging; dépenses, loyer, résultat net; trésorerie; primes; RH and paie. |
| Attack suite | `e2e/api/attacks.ts` | The 48 checks of audit 01, unchanged, rerun to judge its five findings. |
| Concurrency | `e2e/api/concurrency.ts` | New. Nine races of 20 simultaneous requests. |
| Database invariants | `e2e/sql/invariants.sql`, `run-invariants.ts` | 52 SQL blocks (27 from audit 01, 25 new) and 18 live `UPDATE` / `DELETE` probes on the ledgers. |
| Reconcile | `pnpm --filter @erp/api reconcile` | The repo's own check, on the same database. |
| Web | `e2e/web/web.spec.ts` | The browser checks of audit 01 and phase 35 (12). |

Everything goes through the real API and the real database. Two rows are dated in the past by
SQL in the primes chain (a sale validated "last month"): the API cannot do it, and a closed
month is what that rule is about.

## 2. How to reproduce

```bash
docker compose -f infra/docker-compose.yml up -d db db_test
docker exec erp-saas-db-1 psql -U erp -d postgres -c 'CREATE DATABASE erp_audit02'
(cd apps/api && DATABASE_URL_MIGRATE=postgresql://erp:erp@localhost:5432/erp_audit02 pnpm exec prisma migrate deploy)
NEXT_PUBLIC_API_URL=http://localhost:3003 pnpm build
AUDIT_DB=erp_audit02 e2e/map-stack.sh api &     # port 3003
e2e/map-stack.sh web &                          # port 3005
cd e2e && pnpm install && pnpm install:browsers

bash audit-02/part-a.sh web        # every suite of part A, in order (about 5 minutes)
bash audit-02/baseline.sh          # from the repo root: the baseline (run it on an idle machine)
```

One suite alone, from `e2e/`, with
`API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_audit02 AUDIT_RUN=audit-02`:
`pnpm exec tsx api/scenario.ts`, `api/attacks.ts`, `api/concurrency.ts`, `sql/run-invariants.ts`.
The new suites refuse any database that is not a local `erp_audit02*`.

## 3. Baseline

`e2e/audit-02/baseline.sh`, Node 22; `e2e/artifacts/audit-02/baseline/summary.txt`.

| Command | Result |
|---|---|
| `pnpm lint` | 4/4 tasks, 0 errors, 10 warnings (web) |
| `pnpm typecheck` | 4/4 tasks, 35 s |
| `pnpm test` | shared 533/533, web 59/59, API **870/870** in 65 suites (194 s) |
| `pnpm build` | 3/3 tasks, 99 s |
| `pnpm audit --prod` | 7 advisories: 5 moderate, 2 low (`uuid`, `fast-uri`, `glob`, `minimatch`). No high, no critical. Reachability is part B. |

The API figure is from a second run with nothing else on the machine. The first full run
lost 58 tests in 7 suites, every one on "Exceeded timeout of 5000 ms": the machine was
swapping and the audit's own API and suites shared the CPU (lint took 475 s). That is the
known local weakness of the 5 s Jest timeout, not a product failure; it is worth remembering
that a busy CI runner would show the same red.

The repository is green before the audit. The findings below are not caught by its tests.

## 4. Results (part A)

| Suite | Checks | Pass | Fail |
|---|---|---|---|
| Business scenario | 89 | 87 | **2** (A-1, A-2) |
| Attack suite (audit 01) | 48 | 44 | **2** (01-#1, 01-#2); 2 INFO; 3 more pass by proving 01-#3 and 01-#4 are still there |
| Concurrency | 14 | 14 | 0 |
| Database invariants | 70 | 68 | **2** (01-#1, A-3) |
| Reconcile CLI | 1 | 1 | "Ledgers reconciled: no difference." |
| Web (browser) | 12 | 12 | 0 |

Every failure is one of the findings below. Summaries: `e2e/artifacts/audit-02/*.md` and `.json`.

## 5. The five findings of audit 01: all still open

None was fixed in the code since 2026-10-21.

| # | Severity | Finding | Proof, rerun on `c469e9a` | Cause today |
|---|---|---|---|---|
| 01-#1 | medium | The rows of one operation do not share `createdAt` | attacks, "the rows of one operation share the same createdAt": 5 rows of one transaction, 5 timestamps. Invariant `sale_operation_rows_share_created_at` fails. | `createdAt DateTime @default(now())` in `schema.prisma` (stamped by the Prisma client) |
| 01-#2 | high | An amount over `Decimal(14,2)` answers 500 | attacks, area D: `POST /payments`, `amount: "9999999999999999.99"` → `500 INTERNAL_ERROR` | no maximum in `amountString` (`packages/shared/src/schemas/common.ts:44`) nor in `positiveAmount` (`schemas/payments.ts:19`); only `schemas/expenses.ts` has one. The other amount fields are swept in part B. |
| 01-#3 | medium | The login limiter counts successful logins | attacks, "ten logins from one IP lock out a valid user of another account": the eleventh gets 429 | `apps/api/src/auth/auth.service.ts:169`, the limiter is hit before the password is checked |
| 01-#4 | high | A forged `X-Forwarded-For` bypasses the limiter and is written to the audit trail | attacks, both checks: 11 logins with 11 forged addresses, none limited; `after.ip = "198.51.100.42"` in `audit_logs` | `apps/api/src/setup-app.ts:14`, `trust proxy = 1`. Whether Vercel overwrites the header in production is checked in parts D and E. |
| 01-#5 | low | A refresh token replayed inside the grace window is accepted silently | attacks: the replay inside the window answers 200; nothing is logged | `auth.service.ts:411-426`, unchanged |

## 6. New findings (part A)

### A-1 — A seller's sale leaves from the dépôt principal, not from his truck (critical for the Distribution and Entreprise editions)

**Expected.** `docs/domain.md`, phase 15: "a sale leaves from the chosen dépôt, else the
seller's truck, else the dépôt principal", and phase 24: "a seller always works in the truck
he drives".

**Actual.** In a company with `MULTI_UNIT` (Distribution, Entreprise), a seller invited the
normal way (`POST /users/invite` by the owner) works in the dépôt principal. A truck is created
for him and loaded with 24 pièces. He sells 4 without naming a dépôt:

```
POST /sales/quick  { clientId, warehouseId: null, lines: [{ qty: "4" }], paidAmount: "2000" }   → 201
stock_movements of the sale: warehouseId = dépôt principal
camion = 24.000 (4 pièces physically left it)      dépôt principal = 62.000 (should be 66)
```

`warehouseId: null` is what the web sends when the seller leaves the picker alone
(`apps/web/src/components/sales/sale-screen.tsx:321`).

**Cause.** `apps/api/src/sales/sales.service.ts:78-80`: with no dépôt given, the draft takes
`scope.onlyWarehouse(user)`, "the one dépôt (not a truck) a user works in"
(`sales-force/scope.service.ts:198`). The truck fallback of
`sale-workflow.service.ts:202` then never applies, because the sale already has a dépôt.
The existing test "a seller's sale leaves from his truck" passes only because its seller is
inserted straight into the database with no dépôt access
(`apps/api/test/warehouses.int-spec.ts:141`), a state no real user is in.

**Impact.** The company stock, the sale, the client balance and the cash are right. The stock
per dépôt is wrong for every such sale: the truck keeps goods it no longer has, the dépôt
loses goods it still has. The déchargement at the end of the day then brings back units that
are not on the truck, an inventaire of either place shows an écart, and in `BLOCK` mode a
truck sale can be refused because the dépôt is empty while the truck is full. This is the
daily flow of the edition sold to distributors.

**Fix proposal.** In `createDraftInTx`, do not apply the "only dépôt" default when the
resolved seller drives a truck (leave it to `forSale` at validation); same for orders if they
share the rule. Lock it by rewriting the test with a seller invited through the API, and keep
scenario check "a seller's sale with no dépôt chosen leaves from his truck".

**Reproduction.** `e2e/api/scenario.ts`, area 10 (`api/chains/depots.ts`).

### A-2 — Paying a payroll run that is already paid answers 201 (low)

**Expected.** Nothing is left to pay: a 4xx that says so.
**Actual.** `POST /payroll-runs/:id/payments` with a new `Idempotency-Key` on a fully paid run
answers `201`. No dépense is written and no cash moves, also when 20 such payments are sent at
once (concurrency C5: twenty 201, one dépense). The money is right; the answer is misleading.
**Cause.** `apps/api/src/payroll/payroll-runs.service.ts`, `pay` (line 454): without `items`
it pays the payslips with something remaining, and an empty list is not refused.
**Reproduction.** scenario, area 16, "paying a run that is already paid…".

### A-3 — `payment_allocations` can be rewritten (low)

Every ledger table has a `BEFORE UPDATE OR DELETE` trigger, except `payment_allocations`,
which the balance âgée is computed from. No code updates or deletes it today
(`payments.service.ts` is its only writer); the database would not stop a script or a future
bug. Invariant `ledger_like_tables_without_append_only_trigger`.

### Suspected, not proven

- `POST /payroll-runs/:id/approve` and `POST /incentive-runs/:id/approve` take no
  `Idempotency-Key` (AGENTS.md §3.6). Twenty simultaneous approvals post the salary once
  (C5) and a second approval is refused with 409, so no double effect was found; a client that
  loses the answer gets a 409 instead of the original response.
- Row-level security is enabled on all 104 tenant tables but not `FORCE`d, and any session can
  set `app.rls_bypass`. It protects against a forgotten filter, not against the table owner or
  an SQL injection. The role production really connects as is checked in parts B and D.

## 7. What holds up well

Checked in part A and correct, so it is not broken later by accident:

- **Import.** A USD BR in a dossier posts the supplier and no stock; closing gives the coût de
  revient to the centime (1 755 DA) and replays without a second movement; a late cost moves
  the CUMP of the units on hand only (1 815 DA) and leaves the écart of the sold ones (2 400 DA)
  in the margin report; a USD règlement keeps both balances.
- **Dépôts and tournées.** Transfers, chargement and déchargement never touch the CUMP; stock
  is judged per dépôt in `BLOCK` mode; an order delivered 7 of 10 makes one BL, and its replay
  delivers nothing more; the seller session expects exactly his cash and stores the écart;
  emballages given, returned and reversed add up.
- **Credit.** Paid at reception, cheque, cancellation; supplier and client aging always sum to
  the balance, a versement pays the oldest bucket; a bounced cheque gives the debt back with
  the fees; the relevé ends on the balance.
- **Charges and résultat net.** Rent by day, a whole month equals the lease, the rent payment
  is cash only and cannot be paid twice; the Vue d'ensemble's marge − charges = résultat net.
- **Trésorerie.** Opening once, transfer summing to zero, refused above the balance, comptage
  with its reason, the règlement of a BR cancelled only with the BR, `GET /treasury/reconcile`.
- **Primes.** An approved month is frozen (the database refuses the update) and a sale
  cancelled the month after is taken back in that later month.
- **Paie.** A payslip checked against an independent computation of the 2022 IRG barème
  (58 000 brut, CNAS 5 220, IRG 6 550, net 46 230, avance 5 000, net à payer 41 230); approval
  numbers the run, locks the month and posts the ledgers; payment and its replay.
- **Concurrency, 20 at once.** The last unit (one sale wins in `BLOCK`, 20 pass in `WARN` and
  the stock is exactly −20); two products locked in opposite orders; one draft validated or
  cancelled 20 times; 20 versements; one `Idempotency-Key` 20 times (one row, 19 answers
  "in progress"); transfers out of one caisse (exactly 10 of 20) and in both directions; one
  payroll run approved and paid 20 times. No 500, no deadlock, no lost update, no number burned.
- **The database.** Every cached balance equals its ledger (stock per dépôt, clients,
  suppliers in both currencies, employees, cash, emballages, congés); numbers are contiguous
  for the 15 document types; a real `UPDATE` and `DELETE` is refused on the nine ledgers; every
  table with a `tenantId` has RLS, a tenant policy and an index starting with `tenantId`; all
  money is `Decimal(14,2)`, all quantities `Decimal(14,3)`, no float outside the two geo columns.
- **Recovery, seen by accident.** The database container stopped during the audit; the API
  answered `DB_UNAVAILABLE` and served again by itself once the database was back.

## 8. Findings table (so far)

| # | Severity | Part | Finding | Proof |
|---|---|---|---|---|
| A-1 | critical (Distribution, Entreprise) | A | A seller's sale leaves from the dépôt principal, not his truck | `artifacts/audit-02/scenario.md` |
| 01-#2 | high | A (B) | An amount over `Decimal(14,2)` answers 500 | `artifacts/audit-02/attacks.md` |
| 01-#4 | high | A (B) | Forged `X-Forwarded-For` bypasses the limiter and is audited | `artifacts/audit-02/attacks.md` |
| 01-#1 | medium | A | Rows of one operation do not share `createdAt` | `attacks.md`, `db-invariants.md` |
| 01-#3 | medium | A (B) | The login limiter counts successful logins | `artifacts/audit-02/attacks.md` |
| A-2 | low | A | Paying a paid payroll run answers 201 | `artifacts/audit-02/scenario.md` |
| A-3 | low | A | `payment_allocations` has no append-only trigger | `artifacts/audit-02/db-invariants.md` |
| 01-#5 | low | A (B) | Refresh token replay accepted silently in the grace window | `artifacts/audit-02/attacks.md` |

The go / no-go and the fix plan are written when the five parts are in. From part A alone:
A-1 must be fixed before a distributor with trucks uses the product; it does not touch a
grossiste without trucks.

## 9. Not tested, and why

- Parts B, C, D, E: not started.
- A sale validated in a past month through the API: impossible, so the primes chain backdates
  one sale by SQL on the audit database.
- Phases 19, 23, 27, 28, 29, 32 are not built; nothing about them is counted as a bug.

## 10. Artifacts

| File | Content |
|---|---|
| `e2e/artifacts/audit-02/scenario.md`, `attacks.md`, `concurrency.md`, `db-invariants.md` (+ `.json`) | Every check, expected and actual |
| `e2e/artifacts/audit-02/concurrency-statuses.txt` | The status codes of each race |
| `e2e/artifacts/audit-02/web.json` | The Playwright report |
| `e2e/artifacts/audit-02/baseline/summary.txt` | Baseline exit codes and times |
| `e2e/artifacts/audit-02/routes.md`, `routes.json` | The 352 API routes read from the controllers (`audit-02/routes.ts`), the input of part B |
| `e2e/artifacts/audit-02/*.log` | Raw outputs; git-ignored (`*.log`), regenerated by the commands of section 2 |

Changes to the existing suites, none of them weakening a check: `api/fixture.ts` lifts the
5-user plan limit on an audit database (two attack checks could no longer invite their user);
`sql/invariants.sql` knows the document types, platform tables and geo columns added since
audit 01; one scenario check ignores the audit row the super-admin writes when lifting that limit.
