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
| A. Correctness | **done** (sections 1 to 10) |
| B. Security | **done** (sections 11 to 22) |
| C. Scaling | not started |
| D. Availability | not started |
| E. The web from outside | not started |

**Fix batch 1** (branch `fix/audit-02-batch-1`, 2026-11-14) fixed A-1, B-1, B-2, B-3, B-4 with
01-#2, and 01-#4. Sections 1 to 22 are the audit as it was run on `c469e9a` and are left as
written; what changed since is section 23.

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

## 8. Findings table (part A; the table of parts A and B together is section 20)

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

- Parts C, D, E: not started. What part B could not test is section 21.
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


---

# Part B — Can someone break in? (security)

Run on 2026-11-14, same commit, same database `erp_audit02`, same built API on port 3003.
No request was sent to production. `apps/` and `packages/` are untouched.

## 11. What was audited (part B)

Part B is eight new suites under `e2e/api/security/`. `api/attacks.ts` (audit 01) is left as
it was, so its 48 checks stay comparable; its five findings are judged again in section 19.

| Suite | File | What it covers |
|---|---|---|
| Recorder | `record.ts`, `core-chain.ts` | Runs the chains of part A plus one chain for the routes of phases 1–11, twice, on two disjoint sets of 8 companies, and keeps every request (about 330 per set). The sweeps replay these: their bodies are valid by construction. |
| B1 Tenant isolation | `isolation.ts`, `isolation-fk.ts` | Every route with an id, read from the controllers. |
| B2 Permissions | `permissions.ts` | The role × route matrix, generated; what figures each role is shown. |
| B2 Scopes | `scopes.ts` | Seller portfolio, dépôt reach, "Voir les statistiques", pay, Excel exports. |
| B3 Auth and sessions | `auth.ts` | Tokens, sessions, links, enumeration, cookies, CSRF, CORS, super-admin. |
| B4 Input | `input.ts` | Mass assignment, amounts, text, query strings, raw bodies, PDF, Excel. |
| B5 Files and links | `files.ts` | Import files, zip bomb, public share links. |
| B6 Assistant | `assistant.ts` | Tools, scope, injection through data, the provider key. |
| B7 Secrets and logs | `secrets.ts`, `audit-02/secrets-scan.sh` | The API log, Sentry, the database, the git history. |
| B8 Dependencies | `pnpm audit --prod` | Reachability of each advisory. |

Two stand-ins replace third parties, so nothing leaves the machine: a stub model behind the
assistant (`assistant.ts` listens on `:3999` and asks for exactly the tools a test names) and
a Sentry sink (`lib/sentry-sink.ts`).

## 12. How to reproduce (part B)

Database, build and web as in section 2, then:

```bash
AUDIT_DB=erp_audit02 AI_PROVIDER=OPENAI_COMPATIBLE AI_MODEL=audit-stub \
AI_BASE_URL=http://127.0.0.1:3999/v1 AI_API_KEY=sk-AUDIT02-CANARY-KEY-do-not-leak \
  e2e/map-stack.sh api > e2e/artifacts/audit-02/api-b.log 2>&1 &
bash e2e/audit-02/part-b.sh        # every suite of part B, in order (about 7 minutes)
```

One suite alone, from `e2e/`: `. audit-02/b-env.sh && ./node_modules/.bin/tsx api/security/<suite>.ts`
(`record.ts` first: the sweeps read its recording). **`files.ts` ends with a zip bomb that
kills the API** (finding B-1): start the API again before running anything else.

## 13. Results (part B)

| Suite | Checks | Pass | Fail | Findings |
|---|---|---|---|---|
| B1 Tenant isolation | 28 (+4 info) | 28 | 0 | none |
| B2 Permissions | 12 (+2 info) | 9 | **3** | B-3, B-7 |
| B2 Scopes | 29 (+5 info) | 24 | **5** | B-5, B-6, B-14 |
| B3 Auth and sessions | 27 (+5 info) | 21 | **6** | B-8, B-10, B-11, B-12 |
| B4 Input | 8 (+7 info) | 7 | **1** | B-4 |
| B5 Files and links | 17 (+6 info) | 14 | **3** | B-1, B-13 |
| B6 Assistant | 18 (+11 info) | 17 | **1** | B-15 |
| B7 Secrets and logs | 7 (+5 info) | 4 | **3** | B-2, B-9 |
| Invariants of part A, run again after the hostile input | 70 | 67 | 3 | 01-#1, A-3, and one false alarm (below) |
| Reconcile CLI, after | 1 | 1 | 0 | "Ledgers reconciled: no difference." |

Every failure is one of the findings below. The third invariant failure is not a wrong number:
`input.ts` sold three times at a price of 0 DA, and a sale worth 0 writes no ledger line
(`validated_sale_has_ledger_and_audit` expects one). The stock, the balances and the cash of
every company still equal their ledgers after 1 658 hostile requests.

## 14. Tenant isolation (B1): holds on every route

**No finding.** 174 of the 174 routes with an id in their path were covered.

- **Replay.** 187 valid requests of one company were sent again by the same user with one id
  of another company in the path, the query string or the body (a foreign key): 153 refused
  (404, 403, or "Unknown client / supplier / product…"), 16 lists answered empty, 18 were
  stopped by a state check first ("only a draft can be edited").
- **Those 18, on fresh drafts.** `isolation-fk.ts` redoes them as a new company on its own
  open draft, 23 checks: a sale, a BR, an inventory, an order, an import dossier, a brand, a
  dépôt, a user's access, a dépense, a règlement, an avance, a payroll draft and a salary
  payment each refuse another company's client, product, dépôt, supplier, dossier, sale line,
  order line, livreur, caisse and employee.
- **Brute force.** The 88 routes the chains never call were called with one id of each of
  the 85 tables of the other set of companies: 7 480 requests, none answered with a row.
- **Proof in the database.** A fingerprint of every row of the 8 victim companies (104
  tables) is identical before and after; none of the 150 foreign keys between tenant tables
  joins two tenants; no answer carried an id of the other set; no 5xx.

Limit, stated plainly: 57 write routes were reached only by brute force with an empty body.
They answered 4xx and changed nothing, but where the body is validated before the id is read
this does not prove the lookup itself. They are listed in `isolation-coverage.md`. All of
them go through the same Prisma tenant extension and row-level security as the 117 others.

## 15. Findings of part B

### B-1 — A 1 MB Excel file kills the API, and anyone can sign up to send it (high)

**Expected.** An upload cannot take the service down (prompt B5, "zip bomb").
**Actual.** A company created by `POST /auth/register` a second earlier uploads a valid
`.xlsx` of 1.0 MB whose only sheet is 4 000 000 identical rows (305 MB once inflated):

```
POST /imports/CLIENTS/preview  (multipart, bomb.xlsx, 1 092 935 bytes)
API memory 342 MB → 1 748 MB in 14 s; /health stops answering; then
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

The process is gone; every user of every company is cut off until it is started again.
**Cause.** The 10 MB limit of `imports.controller.ts:66` is on the zipped file;
`imports/file-reader.ts:60` then loads the whole workbook in memory
(`workbook.xlsx.load(data)`) and only counts the rows afterwards (`IMPORT_MAX_ROWS`, line 45).
**On Vercel** one function instance dies, not a server; what that means with shared
instances is part D.
**Fix proposal.** Read with the streaming reader of exceljs (`stream.xlsx.WorkbookReader`) and
stop at row 10 001, or check the inflated size of the zip entries before parsing. Lock it
with the last check of `files.ts`.
**Reproduction.** `files.ts`, area "zip bomb"; `artifacts/audit-02/zip-bomb-crash.txt`.

### B-2 — Passwords, cheques and salaries are sent to Sentry (high, when `SENTRY_DSN` is set)

**Expected.** Prompt B7: passwords, tokens, full cheque or salary data are not sent to Sentry.
**Actual.** With a DSN (here a local sink), two things leave for the third party:

- every 500 carries the body of the request that failed: `request.data` =
  `{"clientId":…,"mode":"CHEQUE","reference":"<cheque number>","bank":"<bank>",…}`;
- one request in ten (`tracesSampleRate: 0.1`) is traced with the attribute
  `http.request.body.data`. Seen in the sink, in clear: the body of `POST /auth/login`
  (password), of `POST /auth/password` (current and new password), of
  `POST /admin/auth/login` (the super-admin's password and TOTP code), and of
  `POST /employees/:id/salaries` (the salary). Also `url.full` of `/s/<token>`.

The `Authorization` header and the cookies are not sent. The API log itself holds no body.
**Cause.** `apps/api/src/instrument.ts`: `Sentry.init` keeps the SDK's default, which records
incoming request bodies; `scrubPosition` only removes the position of phase 35.
**Not known from here:** whether production has a DSN (part D reads the deployment).
**Fix proposal.** `httpIntegration({ maxIncomingRequestBodySize: 'none' })` (or drop
`request.data` and the `http.request.body.data` attribute in `beforeSend` /
`beforeSendSpan`), and strip the token from `/s/…` and `/auth/invitations/…` URLs. Lock it
with `secrets.ts`, areas "Sentry". If a DSN was ever live, rotate nothing but treat the
Sentry project as holding passwords: purge its events.
**Reproduction.** `secrets.ts`; `artifacts/audit-02/sentry-leaks.txt` (values masked).

### B-3 — A user given "manage users" can make himself a manager, or take a manager's account (high)

**Expected.** `docs/domain.md`, phase 24: "a user who manages users or access never gives
more than he has"; `USERS_MANAGE`: "never above his own".
**Actual.** A SUPERVISOR to whom the owner granted `USERS_MANAGE` (he cannot read
`/reports/margin`: 403):

```
POST /users/invite { role: "MANAGER", mode: "PASSWORD", password: <his choice> }  → 201
   login as that manager → GET /reports/margin                                    → 200
PUT  /users/<a livreur> { role: "MANAGER" }                                        → 200
POST /users/<the real manager, who holds SALARY_VIEW>/reset-password
     { mode: "PASSWORD", password: <his choice> }                                  → 200
   login as him → GET /employees (salaries)                                        → 200
```

Granting a permission he does not hold is refused (`ACCESS_ABOVE_GRANTER`), and an owner
account is protected everywhere; the role and the password of everyone else are not.
**Cause.** `apps/api/src/users/users.service.ts`: `invite` (line 101) and `update` (line 154)
only guard the role `OWNER`; `resetPassword` (line 296) only guards an owner's account.
By default `USERS_MANAGE` is the owner's alone, so this needs an owner who delegated it.
**Fix proposal.** In `invite`, `update` and `resetPassword`, refuse when the effective
permissions of the target (after the change) are not a subset of the actor's. Lock it with
the fourth check of area B2 in `permissions.ts`.

### B-4 — 500 on valid and hostile input, on 19 routes (high; widens 01-#2)

Audit 01 found it on `POST /payments`. The sweep of every amount, quantity and text field of
the recorded requests (1 658 requests) finds three causes:

| Cause | Example | Routes |
|---|---|---|
| An amount the column cannot hold. `"999999999999.99"` fits `Decimal(14,2)` and still fails once a total or a balance is computed from it. | `POST /sales/quick`, `lines[].unitPriceHt` | `/sales`, `/sales/quick`, `/payments`, `/purchases`, `/supplier-payments`, `/clients/:id/adjustments`, `/import-files/:id/late-cost`, `/employees/:id/advances`, `/cash-accounts/:id/counts`, `/products/:id/packaging`, `PATCH /tenant/settings` |
| Text that is not valid UTF-8 (a lone surrogate, `"\uD800"`). | `POST /employees`, `fullName` | `/employees`, `/warehouses`, `/routes`, `/visits`, `/import-files`, `/incentive-plans`, `/clients/:id/adjustments`, `/cash-accounts/:id/counts` |
| `factorToBase` empty or in Arabic digits. | `POST /products`, `units[].factorToBase` | `/products` |

Nothing is written (the transaction rolls back) and the answer shows no internals
(`{"code":"INTERNAL_ERROR","message":"Internal server error"}`). Each one is an alert in
Sentry and, with B-2, a request body sent there.
**Cause.** No upper bound in `amountString` (`packages/shared/src/schemas/common.ts:44`) and
`positiveAmount` (`schemas/payments.ts:19`); `all-exceptions.filter.ts:99` maps only the
Prisma error `P2002`, so a numeric overflow or an invalid text from Postgres becomes a 500.
**Fix proposal.** One maximum for money and quantities in `common.ts` (as `expenses.ts`
has), a text refinement that rejects unpaired surrogates, and the filter answering 400 for
Postgres classes 22003 and 22021. Lock it with `input.ts`, "no hostile value answers 5xx".
**Reproduction.** `input.ts`; `artifacts/audit-02/input-detail.json` lists the 30 cases.

### B-5 — The journal shows every dépôt to a manager limited to one (medium)

**Expected.** Phase 24: "Outside his reach a document is not there (404, empty list)".
**Actual.** A MANAGER who works only in the annexe finds nothing of the dépôt principal in
any other GET route, and every write there is refused. `GET /audit-logs` gives him its
sales and their numbers, its dépenses with their payee, its inventories, its caisse and the
names of its employees.
**Cause.** `apps/api/src/audit/audit-logs.service.ts:74` filters pay lines only
(`SALARY_VIEW`); nothing filters by dépôt.
**Reproduction.** `scopes.ts`, "a MANAGER working only in the annexe…".

### B-6 — "Voir les statistiques" still opens the client ledger, the unpaid documents and the user list (medium)

**Expected.** Phase 24: VIEW_STATS gives "its dashboard, reports and sell-out figures, never
a single document, client ledger detail or user list".
**Actual.** A MANAGER whose only access is VIEW_STATS on the annexe: `GET /sales` is empty and
selling is refused (correct), but `GET /clients/:id/statement` → 200 with the numbers of
the documents, `GET /clients/:id/unpaid-documents` → 200 with the id, number and amounts of
the documents of **both** dépôts, `GET /users` → 200, and the journal of B-5.
`unpaid-documents` also gives the documents of the other dépôt to a user who works
(OPERATE) in one only, where the statement, by design, shows them without a link.
**Reproduction.** `scopes.ts`, the two "Voir les statistiques" checks.

### B-7 — Purchase prices and supplier debts are readable by every role (medium)

**Expected.** `VIEW_COST_AND_MARGIN`: "see CUMP, stock value, costs and margins";
`SUPPLIERS_ACCOUNT`: "supplier balances, ledgers, statements".
**Actual.** A SELLER or a LIVREUR, with the default permissions of his role:
`GET /purchases` and `GET /purchases/:id` → every BR with `lines.unitCost`, `lineHt`,
`totalHt`, `totalTtc`; `GET /suppliers` and `/suppliers/:id` → `balance` and
`balanceCurrency`. The same user gets 403 on `/reports/margin` and no `avgCost` in
`/stock`, and the assistant hides the total of a BR from him
(`assistant-tools.service.ts:307`): the screens do not.
**Cause.** `PURCHASES_VIEW` and `SUPPLIERS_VIEW` are in `VIEW_ALL`
(`packages/shared/src/permissions.ts:233`), and neither the purchase DTO nor the supplier
DTO (`suppliers.service.ts:41`) looks at the two permissions above. An owner can take
`PURCHASES_VIEW` away user by user; nothing tells him he should.
**Reproduction.** `permissions.ts`, the two "no … figure is shown" checks. 7 135 answers
were read as the five non-owner roles in 8 companies; these are the only cost, margin or pay
figures found.

### B-8 — Anyone can lock a user out, and the lock tells that the account exists (medium)

- Five wrong passwords, each from another forged address (01-#4), lock the account for 15
  minutes; the **right** password is then refused (`423 ACCOUNT_LOCKED`). Repeated every 15
  minutes, an owner whose email or phone number is known never gets in.
- After five attempts an existing account answers `ACCOUNT_LOCKED`, an unknown one keeps
  answering `INVALID_CREDENTIALS`; `POST /auth/register` answers `EMAIL_ALREADY_USED`.
  Before the fifth attempt the two answers are identical, also in time (57 ms and 47 ms, medians of 12).

**Cause.** `auth.service.ts:188-192`, the lock is checked before the password and has its own
error code. **Reproduction.** `auth.ts`, area "User enumeration and account lock-out".

### B-9 — One-time links are written to the log (medium)

`GET /s/<token>` and `/auth/invitations/<token>[/accept]` are logged with their URL: 3 lines
in `api-secrets.log`. Whoever reads the logs can open a shared facture or relevé for 7 days,
or use an invitation not yet accepted (72 h) to choose that user's password. Passwords,
access and refresh tokens, cookies, cheque and salary data are **not** in the log, and
`Authorization` and `Cookie` are redacted. **Cause.** `app.module.ts`, `redact` covers
headers; `common/log-privacy.ts` strips the position only.

### Low

| # | Finding | Proof | Cause |
|---|---|---|---|
| B-10 | A super-admin TOTP code opens a second session inside its window (RFC 6238 §5.2: once). | `auth.ts`, "a TOTP code cannot be used twice" | `admin/totp.ts:66`, no last-used step is kept |
| B-11 | `POST /auth/refresh` accepts a cross-site form (`Origin: https://evil.example`, urlencoded) and rotates the session. Only `SameSite=Lax` stops a hostile page; the answer is not readable by it (CORS). | `auth.ts`, "a cross-site form…" | `auth.controller.ts`, no `Origin` check |
| B-12 | The API starts in production mode with the `JWT_ACCESS_SECRET` printed in `.env.example`; `COOKIE_SECURE` defaults to `false`. A token forged with a known secret still needs a live session id (checked on every request), which limits the damage. | `auth.ts`, "the API refuses to start…" | `config/app-config.ts:15`, length only |
| B-13 | A shared PDF is served with no `Cache-Control`; any SELLER can revoke a link made by someone else (204); `GET /s/:token` has no limit of its own (40 openings = 40 PDFs rendered and 40 journal rows; part D). | `files.ts`, area "Public share links" | `printing.controller.ts:162`, `share-links.service.ts:66` |
| B-14 | With `sellerScope = ASSIGNED_ONLY`, `GET /stock/:productId/movements` shows a seller the id and number of another seller's sale (not its client, not its amount). | `scopes.ts`, "seller 1 finds nothing…" | `stock-queries.service.ts:368` |
| B-15 | If the model asks for a tool named `constructor`, `toString` or `__proto__`, the turn ends in `AI_UNAVAILABLE` instead of `INVALID_INPUT`. No effect on data. | `assistant.ts`, "a tool name that is a property…" | `assistant-tools.service.ts:70`, lookup in a plain object |

### Suspected, not proven

- **What production is configured with.** `JWT_ACCESS_SECRET`, `COOKIE_SECURE`, `SENTRY_DSN`
  and the database role cannot be read with anonymous GETs. Part D reads the deployment
  files; the owner should compare the Vercel variables with B-2 and B-12 today.
- **A company's own model URL.** When the super-admin allows a company its own provider,
  the base URL must be public HTTPS, checked on save and before each use (11 private or
  odd forms refused here). The HTTP client follows redirects and resolves the name again, so
  a public URL that redirects to a private address, or changes address between the check and
  the call, may still reach the internal network. Not reproducible without a public host.
- **Row-level security** is not `FORCE`d and any session of `erp_app` can
  `SET app.rls_bypass = 'on'` (0 rows before, 149 after, on `clients`). It protects against a
  forgotten filter, not against SQL injection. No injection was found (section 16).

## 16. What holds up well (part B)

- **Isolation between companies**, on all 174 id routes (section 14).
- **The role matrix.** 956 role × route pairs a role must not reach all answer 403
  (MANAGER 49, SELLER 222, STOREKEEPER 240, SUPERVISOR 203, LIVREUR 242), read from the
  decorators and `ROLE_PERMISSIONS`. A revoke applies at once. A manager cannot grant what he
  does not hold, edit an owner, or invite one.
- **Seller scope.** Under `ASSIGNED_ONLY`, seller 1 finds nothing of seller 2's client, sale,
  versement or order in any GET route (B-14 apart), cannot sell, collect, order, visit,
  return, share, edit or cancel there, and his reports and dashboard are his own whatever
  `sellerId` or `teamOf` he sends. His supervisor sees his sales and not the other seller's.
- **Dépôt reach.** Every write in a dépôt outside the user's reach is refused, including
  paying from its caisse, counting it, and giving oneself access to it.
- **Pay.** A manager without `SALARY_VIEW` finds none of the pay rows of the company
  (dépenses of avances and salaries, payslips, runs, employee ledger) in 828 GET paths; the
  salary total in charges and in the cash summary is the documented exception.
- **Exports.** No export gives the margin or the stock value without `VIEW_COST_AND_MARGIN`
  (the overview keeps its labels, with empty cells); none opens without `EXPORT_DATA`.
- **Sessions.** Expired, unsigned and re-signed tokens are refused; the role and the company
  come from the session row, not from the token; logout, revocation by the owner, password
  change, role change and deactivation apply to tokens already issued.
- **Links.** Invitation, reset and share links are 32 random bytes, stored as hashes, used
  once (20 simultaneous uses: one wins), and unknown, used, expired, replaced and revoked
  links all get the same answer. A relevé link shows that client only.
- **Cookies and CORS.** `HttpOnly`, `SameSite=Lax`, path `/auth`, no refresh token in the
  web answer; the cookie opens no business route; only `WEB_ORIGIN` is allowed.
- **Super-admin.** Password and TOTP both needed; tenant and admin tokens do not cross;
  impersonation is read-only, journaled request by request, and dies with the admin session.
- **Mass assignment.** 76 create routes sent `id`, `tenantId`, `createdAt`, `createdBy`,
  `number`, `status`, `balance`, `role`, `isFree`, `edition`, `permissionGrants`: no row took
  any of them.
- **SQL.** Every raw query is a tagged template with bound values; the about 30
  `Prisma.raw` fragments and the 3 `$queryRawUnsafe` calls take code constants only
  (aliases, column names, a whitelisted `groupBy`). 91 list routes with hostile query
  strings: no 5xx, no delay, no SQL in an answer. No error shows a stack or a path.
- **Stored markup.** A product, a client and a note holding `<img>`, `<iframe file://>`,
  `<script>` and `@import` are printed as text in the BL and the relevé; the PDF renderer
  (JavaScript off, escaping by default) called no URL and read no file. A client named
  `=HYPERLINK(…)` is a text cell in the exports, never a formula. The web has no
  `dangerouslySetInnerHTML`; the assistant's Markdown renders no image, no HTML and no
  external link.
- **Uploads.** Over 10 MB: 413. Not a spreadsheet: 400. Over 10 000 rows: refused. The file
  is a database column, so its name is never a path.
- **Assistant.** Seven tools, all read-only, each through the scoped service of its screen.
  With a model that obeys the attacker completely: another company's client is `NOT_FOUND`,
  another seller's client, sale and versement are `NOT_FOUND`, costs are absent without the
  permission, unknown tools do nothing, a loop stops after 6 rounds, 10 questions a minute.
  A client named "IGNORE ALL PREVIOUS INSTRUCTIONS…" reaches the model as a tool result only.
  The provider key travels in the `Authorization` header only and comes back neither in an
  answer, the journal, the database nor the log, also when the provider repeats it in an error.
- **Secrets.** 328 commits on 99 branches: no key, token, private key, real database URL or
  DSN was ever committed (the scan finds its control). The six env files in git are examples
  and CI throwaways. Passwords are argon2id.

## 17. Dependencies (B8)

`pnpm audit --prod`: 7 advisories, 5 moderate and 2 low, **no high, no critical**.

| Package | Path | Reachable? |
|---|---|---|
| `uuid` < 11.1.1 (buffer check in v3/v5/v6 with `buf`) | `exceljs` | No: exceljs calls `v4()` without a buffer. |
| `fast-uri` < 3.1.9 (4 advisories) | `ajv`, under the Sentry bundler plugins, `prisma` dev tooling and `@hookform/resolvers` | No: build and CLI tools; the web uses the zod resolver, nothing imports `ajv`. |
| `glob` ≤ 14.0.1, `minimatch` < 11.0.1 | Sentry bundler plugins | No: build time only, no user input. |

## 18. Notes that are not findings

- A sale line at 0 DA is accepted from an owner (three were made by the sweep). The numbers
  stay right; whether a free sale outside a promotion should exist is a product decision.
- `"1,5"` is accepted as an amount and stored `1.50` (French comma); a unit cost and an
  exchange rate keep 4 decimals, a quantity 3: by design.
- The assistant tool `sales_summary` asked for years 0001 to 9999 answers `FAILED` (caught).

## 19. The findings of audit 01 that part A left to part B

| # | After part B |
|---|---|
| 01-#2 | Still open, and wider: B-4. |
| 01-#3 | Still open (not re-tested beyond `attacks.ts`). |
| 01-#4 | Still open. Part B used it throughout: every login of `auth.ts` chooses its own address. It is what makes B-8 unlimited. Whether Vercel overwrites the header is for parts D and E. |
| 01-#5 | Still open; B-11 is the same route. |

## 20. Findings table (parts A and B)

| # | Severity | Part | Finding | Proof |
|---|---|---|---|---|
| A-1 | critical (Distribution, Entreprise) | A | A seller's sale leaves from the dépôt principal, not his truck | `artifacts/audit-02/scenario.md` |
| B-1 | high | B | A 1 MB Excel file kills the API; open signup is enough | `files.md`, `zip-bomb-crash.txt` |
| B-2 | high (if Sentry is on) | B | Passwords, cheques and salaries are sent to Sentry | `secrets.md`, `sentry-leaks.txt` |
| B-3 | high | B | "Manage users" lets a user create or take over a manager account | `permissions.md` |
| B-4 / 01-#2 | high | A, B | 500 on large amounts, invalid text and bad factors, 19 routes | `input.md`, `input-detail.json` |
| 01-#4 | high | A | Forged `X-Forwarded-For` bypasses the limiter and is audited | `attacks.md` |
| B-5 | medium | B | The journal ignores dépôt reach | `scopes.md` |
| B-6 | medium | B | "Voir les statistiques" opens ledger, unpaid documents, user list | `scopes.md` |
| B-7 | medium | B | Purchase prices and supplier debts readable by every role | `permissions.md` |
| B-8 | medium | B | Anyone can lock an account; the lock and the signup reveal accounts | `auth.md` |
| B-9 | medium | B | Share and invitation tokens are logged | `secrets.md` |
| 01-#1 | medium | A | Rows of one operation do not share `createdAt` | `attacks.md`, `db-invariants.md` |
| 01-#3 | medium | A | The login limiter counts successful logins | `attacks.md` |
| B-10 | low | B | TOTP code accepted twice | `auth.md` |
| B-11 | low | B | Refresh accepts a cross-site form | `auth.md` |
| B-12 | low | B | No guard on the example JWT secret; `COOKIE_SECURE` off by default | `auth.md` |
| B-13 | low | B | Shared PDF cacheable; any seller revokes any link; no limit on `/s/:token` | `files.md` |
| B-14 | low | B | Stock movements show other sellers' sale numbers | `scopes.md` |
| B-15 | low | B | Tool name `constructor` ends the assistant's turn | `assistant.md` |
| A-2 | low | A | Paying a paid payroll run answers 201 | `scenario.md` |
| A-3 | low | A | `payment_allocations` has no append-only trigger | `db-invariants.md` |
| 01-#5 | low | A | Refresh token replay accepted silently in the grace window | `attacks.md` |

All proof files are under `e2e/artifacts/audit-02/`. Totals so far: 1 critical, 5 high,
7 medium, 9 low. The go / no-go and the fix plan are written when the five parts are in.
From part B alone: B-1 and B-2 before real data goes in (one is a way to stop the service
from the signup page, the other may already be copying passwords to a third party); B-3 and
B-7 before an owner gives accounts to staff he does not fully trust.

## 21. Not tested in part B, and why

- **A real model.** Whether a real model obeys an instruction hidden in a client name was not
  tested: no provider key was used. What is proven is that obeying gains nothing.
- **Production configuration** (see "Suspected"): anonymous GETs cannot show it.
- **57 write routes** were covered by brute force only (section 14).
- **The natural expiry of an access token** (15 minutes): an expired token was forged with
  the local secret instead of waiting.
- **XSS in a browser**: judged from the code (React escaping, no raw HTML) and from the
  audit 01 check still green in `attacks.ts`; no new browser run in part B.
- **PINs**: the product has none.
- **Phases 19, 23, 27, 28, 29, 32** are not built.

## 22. Artifacts (part B)

| File | Content |
|---|---|
| `isolation.md`, `permissions.md`, `scopes.md`, `auth.md`, `input.md`, `files.md`, `assistant.md`, `secrets.md` (+ `.json`) | Every check, expected and actual |
| `isolation-coverage.md`, `isolation-detail.json` | Each route, how it was covered and what it answered |
| `permissions-detail.json` | The 956 matrix cells, the routes with no decorator, every figure each role was shown |
| `scopes-detail.json`, `input-detail.json` | The leaks found, the 5xx cases |
| `zip-bomb-crash.txt`, `sentry-leaks.txt`, `secrets-scan.txt`, `pnpm-audit-prod.json` | Proofs of B-1, B-2, the history scan, the advisories |
| `after-b/db-invariants.md` | The invariants of part A after the hostile input |
| `*.log` | Raw outputs, git-ignored; `e2e/.auth/` (git-ignored) holds the recording with its tokens and the raw Sentry envelopes |

Changes outside the new files: `lib/http.ts` gained a recorder hook that is off unless
`record.ts` sets it; `e2e/package.json` gained the script `audit02:b`. No dependency was added.


---

# Fix batch 1

Branch `fix/audit-02-batch-1`, 2026-11-14. Six findings fixed, each with a test in the
repository that failed before the fix, then parts A and B run again on the same database.

## 23. What was fixed

| # | Fix | Test that failed before |
|---|---|---|
| A-1 | With no dépôt chosen, a sale draft no longer takes the user's only dépôt when its seller drives a truck; validation then takes the truck (`sales.service.ts`). | `warehouses.int-spec.ts`: its sellers are now invited through `POST /users/invite` |
| B-2 | The API and the SSR no longer read request bodies for Sentry; one scrubber for the API, the browser and the SSR (`packages/shared/src/sentry-privacy.ts`, on the walker of `position-privacy.ts`) drops bodies, cookies, `Authorization` and the token of `/s/…` and invitation links from errors, transactions, spans and breadcrumbs. | `sentry-privacy.test.ts`; `secrets.ts` |
| B-1 | An `.xlsx` is measured before exceljs parses it (`imports/xlsx-guard.ts`): at most 500 parts, 50 MB inflated (real bytes, zlib stops at the limit), 10 sheets, 20 000 rows and 400 000 cells over all sheets. A CSV has the same cell limit. | `xlsx-guard.spec.ts` (the Jest worker ran out of heap), `imports.int-spec.ts` |
| B-3 | A non-owner cannot invite, edit, promote, deactivate, reactivate, change the permissions of or reset the password of a user of his own role, or of one who holds (or would hold) a permission he lacks: `403 ACCESS_ABOVE_GRANTER`. | `users.int-spec.ts`, "a delegated USERS_MANAGE…" |
| B-4, 01-#2 | Amounts are at most 9 999 999 999,99 and quantities 99 999 999,999 in every shared schema; the filter answers 400 for PostgreSQL 22003 / 22P05; a body with a lone surrogate is refused before any schema; `normalizeDecimal` no longer throws after a failed refine. | `hostile-input.int-spec.ts`, `schemas/common.test.ts` |
| 01-#4 | `TRUST_PROXY` (proxies in front of the API): unset means 1 on Vercel, 0 elsewhere, where `X-Forwarded-For` is ignored. The VPS compose sets 1. | `forwarded-for.int-spec.ts` |

`pnpm lint && pnpm typecheck && pnpm test` on Node 22 before each commit; at the end: shared
552, web 59, API 901 tests in 69 suites, all green.

## 24. Parts A and B, run again

| Suite | Before | After | What is left |
|---|---|---|---|
| Business scenario | 87 / 89 | **88 / 89** | A-2 |
| Attack suite | 44 pass, 2 fail | **45 pass, 1 fail** | 01-#1. The two 01-#4 checks now assert that a forged address is ignored, and pass; 01-#3 is still proven open. |
| Concurrency | 14 / 14 | 14 / 14 | |
| Database invariants | 68 / 70 | 68 / 70 | 01-#1, A-3 |
| Reconcile | no difference | no difference | |
| Web | 12 / 12 | 12 / 12 | |
| B1 Isolation | 28 / 28 | 28 / 28 | |
| B2 Permissions | 9 pass, 3 fail | **10 pass, 2 fail** | B-7 |
| B2 Scopes | 24 pass, 5 fail | 24 pass, 5 fail | B-5, B-6, B-14 |
| B3 Auth | 21 pass, 6 fail | 21 pass, 6 fail | B-8, B-10, B-11, B-12 |
| B4 Input | 7 pass, 1 fail | **8 pass, 0 fail** | |
| B5 Files | 14 pass, 3 fail | **15 pass, 2 fail** | B-13 |
| B6 Assistant | 17 pass, 1 fail | 17 pass, 1 fail | B-15 |
| B7 Secrets | 4 pass, 3 fail | **6 pass, 1 fail** | B-9 |
| Invariants after B | 67 / 70 | **68 / 70** | 01-#1, A-3 |

The zip bomb: `HTTP 400 IMPORT_TOO_MANY_ROWS` after 0.1 s, API memory 274 MB → peak 326 MB,
`/health` answered in 15 ms during the read, the process alive. Every remaining failure is a
finding this batch was told not to touch (A-2, A-3, 01-#1, 01-#3, 01-#5, B-5 to B-15).

Changes to the suites, none weakening a check:

- `attacks.ts`: the two 01-#4 checks passed by proving the bypass; they now fail if it comes back.
- `secrets.ts` provoked its 500 with an amount too large (01-#2), now a 400. It makes the
  database refuse one versement instead (a trigger on the audit database, for its own company,
  dropped right after), so "what a 500 sends to Sentry" is still proven on a real 500.
- `map-stack.sh` passes `TRUST_PROXY`. Part A runs on an API reached directly; part B needs
  `TRUST_PROXY=1`, because `auth.ts` and `secrets.ts` give each login its own address (the
  limiter allows ten a minute per address): there the suites stand in for the proxy.
- `sql/invariants.sql`: a sale worth 0 DA is not expected to have a ledger line (below).

Limit of the Sentry proof: traces are sampled one request in ten, and no span was sampled in
the last run. The error event is proven clean on a real 500; the span shapes are covered by
`sentry-privacy.test.ts` (copied from the envelopes of the audit) and the SDK no longer reads
the body at all.

## 25. Decisions

- **The three sales at 0 DA with no ledger line are correct.** `docs/domain.md`: the client
  account is the ledger of "sales on credit (+), versements (−), returns/avoirs (−)", and
  nothing is owed on a sale worth 0 DA. `sale-workflow.service.ts` writes the `SALE` entry
  only when total + timbre is not zero, on purpose: a line of 0 would change no balance and
  no aging bucket, and would only add a row to the relevé. The sale still has its number, its
  stock movements (the goods left, at the CUMP) and its audit row, and the reconcile finds no
  difference. The invariant was too strict and now says so. Not decided here: whether an owner
  may sell at a price of 0 outside a promotion (section 18); the code is unchanged on that.
- **B-3, "at or above his own".** No ranking of roles exists, so it is defined from what the
  roles can do: an account is below the actor when its role differs from his and every
  permission it holds (role defaults, plus grants, minus revokes) is one he holds. A supervisor
  with `USERS_MANAGE` can therefore manage sellers and livreurs, and not storekeepers (they
  receive goods, he does not), supervisors or managers. Deactivating, reactivating and changing
  permissions follow the same rule, beyond the four actions asked: they were the same hole
  (a supervisor could deactivate the manager). Editing one's own account is unchanged.
- **B-4, the maximum.** 9 999 999 999,99 DA per amount and 99 999 999,999 per quantity: two
  digits under what the columns hold, because totals and balances are computed from what is
  sent. A product of two valid values can still overflow (price × quantity); the database
  refuses it, the transaction rolls back and the filter answers 400. Arabic digits in a number
  are refused (400), as before for every other field.
- **B-1, the answer.** Too many rows, cells or inflated bytes answer `IMPORT_TOO_MANY_ROWS`
  (400), the message the user already has ("split the file"); too many sheets and a broken zip
  answer `IMPORT_FILE_INVALID` (400). No new dependency: the zip directory is read by hand.
  The row limit before parsing is 20 000 `<row>` elements (empty formatted rows count), twice
  the 10 000 data rows an import may hold, which is still checked after parsing.
- **01-#4, the default.** Unset, `TRUST_PROXY` is 0: safe when the API is exposed directly,
  and behind a proxy every user would share the proxy's address and its login limit until the
  variable is set. So `infra/deploy/compose.yml` sets 1 (Caddy replaces a client's own
  header), and Vercel keeps 1 as before. **To check before deploying elsewhere**, and in
  parts D and E: that what stands in front of the API really overwrites `X-Forwarded-For`.
- **A-1, orders.** A bon de commande keeps taking the only dépôt of whoever writes it: its
  delivery leaves from the order's dépôt, else the livreur's truck, "never the seller's truck"
  (`orders.service.ts`), a different rule that the scenario finds correct. Not changed.

## 26. Still open

A-2, A-3, 01-#1, 01-#3, 01-#5 and B-5 to B-15, as described above. If a Sentry DSN was ever
live in production, its project may hold request bodies from before this fix (B-2): purge it.
