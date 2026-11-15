# Test report — phase 36, distribution par véhicule

**Target:** `c06adf0` (`origin/main`; phase 36 is PR #72: `0751faa` API, `7370022` web, `48dbd35` e2e, `284e8e5` docs; migration `20261114232622_vehicle_first_distribution`).
**Branch:** `test/phase-36-vehicle-first`. **Date:** 2026-11-15.
**Prompt:** [`docs/prompts/test-36-vehicle-first.md`](../docs/prompts/test-36-vehicle-first.md). **Spec:** [`phase-36-vehicle-first-distribution.md`](../docs/prompts/phase-36-vehicle-first-distribution.md).
**Rule of the pass:** find and prove, do not fix. Nothing under `apps/` or `packages/` is changed.

**This report covers the baseline, the seed and parts A to E** (part B is section 10, part C
section 11, part D section 12, part E section 13). The final findings table and the verdict are in
section 8, the fix plan in section 9.

## Status (read this first when resuming)

| Part | State | Where |
|---|---|---|
| 0. Baseline and seed | done | `e2e/test-36/baseline.sh`, `e2e/api/vehicles-seed.ts` |
| A. API correctness | done: 109 lines (90 pass, 12 fail on 8 findings, 7 notes) | `e2e/api/vehicles.ts`, `e2e/sql/vehicles-history.sql` |
| B. Scope, isolation and security | done: 117 lines (101 pass, 7 fail on 5 findings, 9 notes) + 1 low from notes | `e2e/api/vehicles-scope.ts`, section 10 |
| C. Concurrency | done: 18 lines (12 pass, 2 fail on 2 findings, 4 notes) | `e2e/api/vehicles-race.ts`, section 11 |
| D. Backfill and upgrade | done: 36 backfill checks (34 pass, 0 fail, 2 info), 4 upgrade runs; 4 findings | `e2e/test-36/part-d.sh`, `e2e/sql/vehicles-backfill.sql`, section 12 |
| E. Web and phone | done: 15 tests on 5 screens = 75 runs (61 pass, 14 fail on 3 findings), 319 proofs | `e2e/web/vehicles.spec.ts`, section 13 |
| Final findings table, go / no-go, fix plan | final, on parts A to E | sections 8 and 9 |

Findings of part A: **1 critical, 1 high, 3 medium, 3 low.** A-2 is critical by the owner's
decision of 2026-11-15: every truck, delivery trucks included, is loaded by chargement each day
and unloaded back to the dépôt, so a delivery BL must take its stock from the truck.

Findings of part B: **0 critical, 3 high, 2 medium, 1 low** (section 10.4). B-4 is high by the
owner's decision of 2026-11-15.

Findings of part C: **0 critical, 0 high, 1 medium, 1 low** (section 11.4).

Findings of part D: **0 critical, 1 high, 2 medium, 1 low** (section 12.4). The backfill itself is
right: it writes only facts, never today's driver, and its second run changes 0 rows. What fails is
the deploy order the runbook gives (D-1) and the commands it gives for Neon (D-2).

Findings of part E: **0 critical, 0 high, 2 medium, 1 low** (section 13.4). Every phase 36 screen
works at 360 px in Arabic; what fails is how some codes are drawn.

**All parts: 1 critical, 5 high, 10 medium, 7 low** (table in section 8).

To rerun: start the stack (section 2), run `pnpm test:vehicles:seed` again if
`e2e/.auth/vehicles-fixture.json` is gone or older than 12 h (it makes new companies).
Parts B, C and E make their own companies on each run and need no seed. The data stays in
the local database `erp_t36`. Part D runs on its own database (`erp_t36_base`, dropped and made
again by `e2e/test-36/part-d.sh`) and needs the old worktree of section 12.1.

## 1. What was tested

| Part | Suite | What it covers |
|---|---|---|
| 0 | `e2e/test-36/baseline.sh` | lint, typecheck, build, test on Node 22 with the Jest integration suites on a scratch database, then the three Playwright projects. |
| 0 | `e2e/api/vehicles-seed.ts` | Three companies through the real API, every user invited with `POST /users/invite` and accepting his invitation. A (Distribution): owner, manager, supervisor with two sellers, a seller outside the team, two livreurs, a storekeeper; dépôt principal + "Dépôt Batna" (`CDD BATNA 05`); five trucks over the two dépôts (`VAN-28 MXT 01` CASH_VAN, `PRV05-DD01` PRESALE, `LIV 28 MIX` DELIVERY, `VAN34-SELF/MT` MIXED, one without type or code); five types (three with `codePrefix`, one without, `HRC` archived). B: the same type codes and truck codes. E: Essentiel. Plus the history part D needs, with the truck the backfill must find for each row (`history` in the fixture): two old seller routes, a vehicle route, two visits linked to van sales, an order whose BL left a truck, an order put on a truck whose BL left the dépôt, an order delivered from the dépôt principal, two visits with neither. |
| A | `e2e/api/vehicles.ts` | Nine areas, each in its own new company: vehicle types; truck identity (API and CHECK constraints written as the app role); driver change (every path, forced rollback, sessions); `driverAt` / `vehicleAt` called on the compiled service, the worker history and both paginations; append-only as both database roles; tournées per vehicle, convert one and bulk; the truck frozen on visits and orders, the order that follows its delivery truck; stock and cash after a driver change; livreurs and activities. |
| A | `e2e/sql/vehicles-history.sql` | 17 rules read with SQL over the whole database after the scenario (driver = last history row, one truck per driver, frozen trucks, truck stock = its movements…), then the repo's own `reconcile` CLI. |
| E | `e2e/web/vehicles.spec.ts` (+ `vehicles-data.ts`, `vehicles.playwright.config.ts`) | Every phase 36 screen in chromium at 360 and 393 px in `ar` and `fr` and at 1280 px in `fr`, each project in its own company made through the API: types, vehicles, driver sheet, history, "Véhicules conduits", tournées, aujourd'hui, orders and deliveries, the bidi of the codes measured glyph by glyph, the wilaya list, English (section 13). |
| D | `e2e/test-36/part-d.sh` | A pre-36 database made by the pre-36 code (`93afa56`) through its API, 50 000 visits / orders added, the phase 36 migration timed with its locks, `db:backfill-vehicles` twice against the truth SQL `e2e/sql/vehicles-backfill.sql`, reconcile; each API version on each schema; the old web against the new API (section 12). |

Everything runs against the **real** built API and the **real** PostgreSQL, on a local database
made for this pass, with the API connected as `erp_app` (row-level security applies). No mock,
no stub. Expected values come from the spec or from SQL written in `e2e/`.

## 2. How to rerun

```bash
# 1. databases (once). erp_t36 is the pass's database; the dev database `erp` is not touched.
docker compose -f infra/docker-compose.yml up -d db db_test
docker exec erp-saas-db-1 createdb -U erp erp_t36
(cd apps/api && DATABASE_URL_MIGRATE=postgresql://erp:erp@localhost:5432/erp_t36 pnpm exec prisma migrate deploy)
docker exec -i erp-saas-db-1 psql -U erp -d erp_t36 < apps/api/prisma/app-role.sql

# 2. baseline (builds with NEXT_PUBLIC_API_URL=http://localhost:3003), then the stack
bash e2e/test-36/baseline.sh
AUDIT_DB=erp_t36 e2e/map-stack.sh api &      # :3003, as erp_app
e2e/map-stack.sh web &                       # :3005 (only the Playwright baseline needs it)

# 3. the data, then one command per part
cd e2e && pnpm install
export API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t36
pnpm test:vehicles:seed     # 3 companies, about 5 s
pnpm test:vehicles:api      # part A, about 15 s; T36_ONLY=driver,stock runs some areas only
pnpm test:vehicles:scope    # part B, about 20 s; its own companies; T36_ONLY=isolation,scope,permissions,gate,hostile,idempotency
PROD_API=https://erp-saas-pi.vercel.app pnpm test:vehicles:scope   # adds the 3 anonymous GETs on production
pnpm test:vehicles:race     # part C, about 15 s; its own companies; T36_ONLY=same,cross,sale,convert; T36_ROUNDS=20
WEB=http://localhost:3005 pnpm test:vehicles:web   # part E, about 5 min; needs the web of step 2; its own companies

# part D, about 2 min: drops and remakes erp_t36_base, needs a built worktree of main before #72
# (section 12.1) and ports 3003 / 3005 free. OLD_WEB=0 skips the two old-web runs.
OLD=../erp-main bash e2e/test-36/part-d.sh       # or: cd e2e && OLD=../../erp-main pnpm test:vehicles:backfill
```

- The suites refuse any database that is not a local `erp_t36*` (`lib/vehicles-fixture.ts`).
  `lib/audit.ts` (the audit 02 helpers the suites reuse) now accepts that prefix too.
- `pnpm test:vehicles:api` writes `artifacts/test-36/vehicles-api.{md,json}` (every check),
  `vehicles-invariants.txt` (the rows that break each SQL rule) and `reconcile.txt`. Like the
  audit 02 suites it exits 0: read the last line (`109 checks · 90 passed · 12 failed`).
- Each finding reruns with that one command; the area to pass in `T36_ONLY` is given with it.
- The Playwright baseline ran on a second database (`erp_t36_base`, made the same way) so the
  web suite's company does not sit in `erp_t36`:
  `DATABASE_URL=… DATABASE_URL_MIGRATE=… ./node_modules/.bin/playwright test --config web/playwright.config.ts --project=desktop --trace off`
  with the API of step 2 started on `AUDIT_DB=erp_t36_base`.

## 3. Baseline

`c06adf0`, Node v22.23.5, pnpm 11.28.6 (`artifacts/test-36/baseline/summary.txt`).

| Step | Result | Time |
|---|---|---|
| `pnpm lint` | pass (4 tasks) | 48 s |
| `pnpm typecheck` | pass (4 tasks) | 15 s |
| `pnpm build` | pass (3 tasks) | 20 s |
| `pnpm test` | pass: API 70 suites / 930 tests, shared 40 files / 573 tests, web 13 files / 59 tests | 302 s |
| Playwright `desktop` (`web.spec.ts`) | 13 passed | 25 s |
| Playwright `mobile` (393 px) | 12 passed | 181 s |
| Playwright `mobile-360` | 12 passed | 180 s |

No timeout, no flake in this run (the Jest suites ran on an empty scratch database, as CI does).
After the pass: `git diff --stat origin/main -- apps packages` is empty.

## 4. Results of part A

| Area (`T36_ONLY=`) | Checks | Pass | Fail | Findings |
|---|---|---|---|---|
| A1 vehicle types (`types`) | 10 | 9 | 1 | A-5 |
| A2 truck identity (`identity`) | 15 | 11 | 4 | A-5, A-6, A-7, A-8 |
| A3 driver change (`driver`) | 12 | 10 | 2 | A-3 |
| A4 history helpers, worker history (`history`) | 6 | 6 | 0 | |
| A5 append-only (`append`) | 4 | 4 | 0 | |
| A6 tournées per vehicle (`tournees`) | 9 | 9 | 0 | |
| A7 frozen truck (`frozen`) | 14 | 13 | 1 | A-2 |
| A8 stock and money (`stock`) | 9 | 7 | 2 | A-1, A-4 |
| A9 livreurs, activities (`activity`) | 5 | 5 | 0 | |
| A10 SQL rules + reconcile (always) | 18 | 16 | 2 | A-1, A-3 (the same rows, seen from the database) |
| Notes (INFO lines, neither pass nor fail) | 7 | | | section 5.5 |
| **Total** | **109** | **90** | **12** | **8 findings** |

`reconcile`: "Ledgers reconciled: no difference". `truck_stock_equals_its_movements` and
`dépôts_sum_to_the_product_level`: no row.

### What the prompt asked to be said in words

- **Code helper, 01, 02, 04 taken:** it proposes **03** (the lowest free number, gaps filled).
  The spec only says "next free number"; 03 is one reading of it. No prefix: `34 SELF/MT 01`;
  no wilaya: `LIV MIX 01`; nothing chosen: `01`; Arabic prefix and lower case kept as typed.
- **A clôture opened on truck 1, then a move to truck 2:** the move is refused while the day is
  open (`SESSION_OPEN_ON_VEHICLE`, on the quick change, the dépôt form and the archive). Once
  it is closed the move passes; the closed session keeps truck 1 and its frozen figures; the
  stock stays where it is (truck 1 kept its 90 units until a déchargement). What follows on
  truck 2 that day has no session: finding A-4.
- **Livreurs:** a livreur is put on a truck by both paths and delivers the orders of his truck.
  He cannot sell, take an order or record a visit: `POST /sales/quick`, `/orders` and `/visits`
  answer 403 `FORBIDDEN`, with or without his truck named. The existing role rules decide,
  nothing in phase 36 opened them.
- **Activity is only a hint:** the driver of a PRESALE truck sells from its stock, takes
  orders, is loaded and unloaded; a seller on a DELIVERY truck sells from it; a route is
  planned for any truck; an order is assigned to a PRESALE truck; a truck with history changes
  type or loses it. Nothing is newly blocked.

## 5. Findings

Each proof is the named check in `artifacts/test-36/vehicles-api.md` (and `.json`), produced by
`pnpm test:vehicles:api`.

### 5.1 Critical

A-2 (below, after A-1, where it was first written) is critical by the owner's decision.

### 5.2 High

#### A-1 (high) A truck switched off with its driver on it: the sale, the visit and the order of the same moment name three different trucks

- **Rerun:** `T36_ONLY=stock pnpm test:vehicles:api`, check "a truck switched off (active: false)
  with its driver still on it…"; SQL rule `visit_sale_left_the_truck_frozen_on_the_visit`.
- **Path:** seller X drives truck `X1`, loaded with 30. Owner: `PATCH /warehouses/X1 {"active": false}`
  → 200, `assignedUserId` kept, no history row. X: `POST /sales/quick` (no dépôt) → 201;
  `POST /visits` with that sale → 201; `POST /orders` → 201; `GET /me/today`.
- **Expected:** one answer to "which truck was he on". The spec freezes the truck "the seller
  drives at `startedAt`" so that phase 37 can count per vehicle.
- **Actual:** the sale left **the dépôt principal** (truck 30 → 30, dépôt principal 1970 → 1967);
  `Visit.vehicleId` = **truck X1**; `Order.vehicleId` = **null**; `/me/today` shows no truck and
  none of its tournées.
- **Cause:** two definitions of "his truck". `VisitsService.create` reads the history
  (`vehicleOfUserAt`, `apps/api/src/tournees/visits.service.ts:88`), which still names him;
  orders, sales, sessions and `/me/today` read `currentVehicleOf`, which wants `active: true`
  (`apps/api/src/stock/vehicles.service.ts:91`, used at `orders.service.ts:103`). And
  `WarehousesService.update` writes `active` without going through `assignDriver`
  (`apps/api/src/stock/warehouses.service.ts:321`), so the history never learns the truck stopped.
- **Why high and not critical:** every ledger is right (reconcile is clean, each dépôt equals its
  movements). What is wrong is the column phase 37 will read: a per-vehicle statistic would give
  truck X1 a sale whose goods left the dépôt.
- **Fix proposal:** switching a truck off frees its driver through `assignDriver` (a row naming
  nobody, refused while his day is open), or is refused while it has one. Lock with an
  integration test that runs this path and asserts the SQL rule above returns no row.

#### A-2 (critical) The BL of an order put on a delivery truck leaves the dépôt principal, not the truck

- **Rerun:** `T36_ONLY=frozen pnpm test:vehicles:api`, check "the BL of an order put on a loaded
  delivery truck leaves that truck…".
- **Path:** truck `LIV 28 MIX` driven by a livreur, loaded with 100 (`LOAD` transfer). A seller
  takes an order with no `warehouseId` and confirms it. Owner:
  `PATCH /orders/:id/livreur {"deliveryVehicleId": LIV}`. The livreur: `POST /orders/:id/deliver` (6 units).
- **Expected:** the goods leave the truck that carries them. Spec: `deliveryVehicleId` is "the
  truck that delivered it … (the BL's dépôt when it is a truck)"; a truck "is already a dépôt …
  with its own stock, chargement and déchargement".
- **Actual:** truck 100 → **100**, dépôt principal 1900 → **1894**, `Order.deliveryVehicleId` = the
  truck. After a day of deliveries the truck still shows everything that was loaded on it and
  the dépôt principal is short by the same quantity.
- **Cause:** the order already has a dépôt. A seller who works in one dépôt gets it on every
  order he takes (`ScopeService.onlyWarehouse`, `apps/api/src/tournees/orders.service.ts:749`),
  and delivery takes `order.warehouseId` before the deliverer's truck (`orders.service.ts:441`).
  The truck is only used when the order has no dépôt at all, which a seller's order never is here.
  The suite shows the other case works: an order whose dépôt is the truck itself (taken by the
  office) leaves the truck.
- **Also:** the live path stores the truck although the BL left a dépôt
  (`orders.service.ts:462`), while the backfill only reads the BL's dépôt. The same delivery
  made before and after phase 36 will not get the same `deliveryVehicleId` (part D to confirm).
- **Owner's decision (2026-11-15):** every truck, delivery trucks included, is loaded by
  chargement each day and unloaded back to the dépôt. A delivery BL must take its stock from the
  truck. So this is a wrong stock figure per dépôt: **critical** by the rule of this pass. After
  a day of deliveries the déchargement sends back goods that already left with the BLs, and the
  dépôt principal is short by the same quantity. Livreurs could not drive a truck before phase
  36, so no company has met this in production yet. The rule belongs in `docs/domain.md`.
- **Fix proposal:** when an order is on a delivery truck (`deliveryVehicleId`), the BL leaves
  that truck whatever `order.warehouseId` says, and the availability shown on the order reads
  the truck. The backfill reads the same rule. Lock with the A7 check above, plus an integration
  test: load 100, deliver 6, unload the rest; the truck ends at 0 and the dépôt at its start
  minus 6.

### 5.3 Medium

#### A-3 (medium) A user who is deactivated, or moved to a role that cannot drive, stays the driver of his truck

- **Rerun:** `T36_ONLY=driver pnpm test:vehicles:api`, the two checks "deactivating a user who
  drives a truck…" and "changing a driver to a role that cannot drive…"; SQL rule
  `driver_is_a_live_user_who_may_drive`.
- **Path:** `POST /users/:id/deactivate` → 200, and `PUT /users/:id {role: "STOREKEEPER"}` → 200,
  on two sellers who each drive a truck.
- **Expected:** the truck is freed with a history row naming nobody, or the change is refused.
  `assignDriver` itself refuses both people (`SELLER_NOT_ALLOWED`), and the spec wants a row for
  "every change" of the driver.
- **Actual:** `warehouses.assignedUserId` still names them; `GET /warehouses` shows the
  deactivated user as today's driver; the truck's tournée is on nobody who can log in; the
  history says he drives it for as long as nobody notices. The worker history of that user stays
  "en cours".
- **Cause:** `UsersService.deactivate` and `update` (`apps/api/src/users/users.service.ts:231`,
  `:151`) do not call `VehiclesService.assignDriver`.
- **Fix proposal:** both free the truck through `assignDriver` in the same transaction (refused
  while his day on it is open). Lock with the SQL rule.

#### A-4 (medium) The second truck of a driver's day has no clôture, and the guard does not protect it

- **Rerun:** `T36_ONLY=stock pnpm test:vehicles:api`, check "cash responsibility after the move…".
- **Path:** seller on truck S1 sells for 5 000 DA cash; his day is closed (expected 5 000, écart
  0); he is moved to S2 and sells for 3 000 DA cash; `POST /seller-sessions` again; then
  `POST /warehouses/S2/driver {"userId": null}`.
- **Expected (spec):** "close the day first, money responsibility must stay clear".
- **Actual:** the second `POST /seller-sessions` returns the same closed session (one per seller
  per day, `seller-sessions.service.ts:169`). Cash collected that day: 8 000 DA; counted in a
  clôture: 5 000 DA. No session names S2, so he is taken off S2 with 3 000 DA in hand and nothing
  objects (200). The clôture screen still shows the live figure of his day, so the money is
  visible, but nothing asks for it before the next change.
- **Related note:** a day opened before he had a truck has `warehouseId` null; the guard only
  looks at sessions that name the truck (`seller-sessions.service.ts:77-78`), so that driver is
  also moved with his day open.
- **Fix proposal:** the guard refuses when the leaving driver has collected cash since his last
  clôture (or has any open day), whatever truck the session names. Lock with this check.

#### A-5 (medium) `_` and `%` in a code are read as wildcards by the uniqueness check

- **Rerun:** `T36_ONLY=types,identity pnpm test:vehicles:api`, the two checks "a code is compared
  as text…".
- **Path:** with truck `VAN-28 MXT 01`: `POST /warehouses {code: "VAN_28 MXT 01"}`. With type
  `AB1`: `POST /vehicle-types {code: "A_1"}` and `{code: "%"}`.
- **Expected:** accepted, they are other codes.
- **Actual:** 409 `VEHICLE_CODE_TAKEN` each time. A type code `%` can never be created once any
  type exists.
- **Cause:** Prisma's `equals` with `mode: 'insensitive'` is an `ILIKE`
  (`apps/api/src/stock/warehouses.service.ts:664`, `vehicle-types.service.ts:150`). The unique
  index on `lower(code)` is right; only the pre-check is wrong.
- **Fix proposal:** compare `lower(code)` in SQL, or drop the pre-check and rely on the index
  (the P2002 mapping is already there).

### 5.4 Low

- **A-6** `POST /warehouses` for a dépôt with an identity field answers 400 `VALIDATION_FAILED`
  (issue `vehicle_fields_on_depot`), while `PATCH` answers `VEHICLE_FIELDS_ON_DEPOT`, the code the
  spec names. Nothing is written either way. Cause: the zod refine runs first
  (`packages/shared/src/schemas/warehouses.ts:38`). `T36_ONLY=identity`.
- **A-7** `GET /warehouses?search=%` returns every dépôt (17 of 17) and `search=N_2` matches
  `VAN-28 MXT 01`: the search is an unescaped `ILIKE` (`warehouses.service.ts:145`). The caller
  only gets rows he may see. `T36_ONLY=identity`.
- **A-8** Code helper: when the prefix and type code fill the 27 characters kept for the base,
  numbers above 99 no longer fit and the helper returns the base **without a number**
  (`"PPPPPPPPPP-28 TTTTTTTTTTTTT"`), the same text for every further truck
  (`packages/shared/src/vehicles.ts:32-37`). With a short base the hundredth truck gets
  `VAN-28 MXT 100` as expected. `T36_ONLY=identity`.

### 5.5 Notes (seen, not counted as findings)

- A type switched off (`active: false`) without being archived is still listed and still accepted
  on a new truck. The spec only speaks of archived types.
- `TRUNCATE vehicle_assignments` is refused to the app role and accepted for the owner role (the
  trigger is `BEFORE UPDATE OR DELETE … FOR EACH ROW`, migration line 139). No other ledger of
  the repo blocks TRUNCATE either.
- After a driver change, the new driver's `/me/today` shows the truck's stops as not visited
  even when the previous driver visited them the same day (`visitedOn(user.id…)`,
  `routes.service.ts:447`). The tournée follows the truck, the "visited" mark follows the person.
- `POST /visits` with `startedAt` 30 days in the future is accepted and gets today's truck. Not
  new in phase 36, but phase 37 will group visits by that date.
- A seller may still name a truck he no longer drives as `warehouseId` of a sale (201): what he
  names is what moves. This is the phase 15 behaviour; part B should look at it as a scope question.
  (Part B: the sale stays inside the company and inside the seller's dépôt reach; see 10.5.)

### 5.6 Suspected, not proven

- ~~`deliveryVehicleId` of a pre-36 order delivered by a truck but booked on the dépôt will stay
  null after the backfill.~~ Answered by part D (12.2): before phase 36 no order could be
  delivered by a truck other than the BL's dépôt (no delivery truck on an order, livreurs drove
  nothing), so on pre-36 rows "the BL's truck" is the whole truth. The two rules only disagree on
  rows written after phase 36, which is A-2.

## 6. What holds up well

- **The history is the truth.** Create with a driver, `PATCH` set and clear, archive and the quick
  change each write exactly one row per truck touched, with who and why; a repeated change writes
  nothing; a refused one writes nothing. Over the whole database, every truck's last row names
  its driver and no driver has two live trucks.
- **One transaction.** A failure forced after the history row (a trigger on the audit insert)
  leaves no row, no driver change, no audit and no half-created truck, on the three paths tried.
- **Append-only** holds for both database roles; row-level security keeps the app role to its
  own company on insert and on read.
- **`driverAt` / `vehicleAt`** are right at the exact `fromAt`, one millisecond before, between
  changes, before the first row and a year ahead. The worker history gives the right periods and
  `toAt`; both cursor paginations are stable while rows are added; a truck outside the reader's
  dépôts shows its code with `inReach: false`.
- **The tournée follows the truck** at once and with no route edit, for the new driver and
  against the previous one, on `/me/today` and on `GET /routes/:id`. Convert one and bulk are
  exact, idempotent and audited; the CHECK refuses a route with no owner.
- **The frozen columns** survive later driver changes; a correction keeps the truck of the visit
  it replaces; a visit typed for a moment before he had the truck gets none.
- **A-1 of audit 02 holds:** after a driver change the sale leaves the truck he drives now, and
  the visit of that sale names the same truck.
- **An order follows its delivery truck:** the new driver has it, the old one gets 404, the
  delivered order stays with who delivered, the cash is his.
- **Validation** is tight on every boundary asked: code 1 / 20 / 21 and 30 / 31, plate 20 / 21,
  wilaya 0 / 1 / 69 / 70, capacity 0 / -1 / huge, each with 400 and never 500; the CHECK
  constraints refuse the same values written with SQL.

## 7. What was not tested, and why

- Part B's own gaps are in 10.7, part C's in 11.6, part D's in 12.6, part E's in 13.6.
- **Production:** only the three anonymous `GET`s of the ground rules were sent, in part B (all
  401). Nothing else.
- **`driverAt` / `vehicleAt` through HTTP:** they have no route. They were called on the compiled
  `VehiclesService` (`apps/api/dist`) with a Prisma client on the scratch database.
- **Idempotency-Key replays** of the driver change and of convert: done in part B (finding B-4).
- **Known, left out by PR #72** (not findings): the per-vehicle report screen, Lighthouse
  Performance.

## 8. Final findings and go / no-go for phase 37 (parts A to E)

### 8.1 Findings table

| # | Severity | Finding | Section | Fix PR (section 9) |
|---|---|---|---|---|
| A-2 | **critical** (owner) | The BL of an order put on a delivery truck leaves the dépôt principal, not the truck | 5.2 | 1 |
| A-1 | high | A truck switched off with its driver on it: the sale, the visit and the order of the same moment name three different trucks | 5.2 | 2 |
| B-1 | high | A manager limited to one dépôt takes a driver off a truck of another dépôt | 10.4 | 3 |
| B-2 | high | Convert puts a seller route on a truck outside the planner's reach, and convert-one writes while answering 404 | 10.4 | 3 |
| B-4 | high (owner) | A driver change replayed after a later change puts the old driver back | 10.4 | 4 |
| D-1 | high | The runbook deploys the API before the migration: 500 on dépôts, tournées, orders and visits until `db:deploy` runs | 12.4 | 0 |
| A-3 | medium | A user who is deactivated, or moved to a role that cannot drive, stays the driver of his truck | 5.3 | 2 |
| A-4 | medium | The second truck of a driver's day has no clôture, and the guard does not protect it | 5.3 | 6 |
| A-5 | medium | `_` and `%` in a code are read as wildcards by the uniqueness check | 5.3 | 8 |
| B-3 | medium | Every user of a dépôt reads who drove each of its trucks, while the user history refuses him | 10.4 | 7 |
| B-5 | medium | Codes and plates keep control, bidi and zero-width characters: two trucks show as `VAN-28 MXT 01` | 10.4 | 8 |
| C-1 | medium | A sale and its visit split over two trucks when the driver changes during the visit | 11.4 | 5 |
| D-2 | medium | The Neon commands of the phase 36 block name no database: as written they migrate and backfill the local one | 12.4 | 0 |
| D-3 | medium | The web of the previous version crashes on the tournée list and the route page once a vehicle route exists | 12.4 | 0 |
| E-1 | medium | A code with an Arabic word is not drawn in the order typed, and two different codes are drawn the same | 13.4 | 8 |
| E-2 | medium | A long code is cut on the vehicle card at every width, with no way to read it in full: two trucks look the same | 13.4 | 11 |
| A-6 | low | `POST /warehouses` answers `VALIDATION_FAILED` where the spec names `VEHICLE_FIELDS_ON_DEPOT` | 5.4 | 9 |
| A-7 | low | The dépôt search is an unescaped `ILIKE` | 5.4 | 8 |
| A-8 | low | The code helper returns the base without a number past 99 on a long base | 5.4 | 9 |
| B-6 | low | Three reach rules for one supervisor's team truck | 10.4 | 9 |
| C-2 | low | A route edit overwrites a convert that committed under it, and its audit "before" is wrong | 11.4 | 9 |
| D-4 | low | The backfill's "else the order's truck" never applies to pre-36 rows | 12.4 | 10 |
| E-3 | low | On a phone the order list cuts the delivery truck off its row | 13.4 | 11 |

**1 critical, 5 high, 10 medium, 7 low: 23 findings.** Every one reruns with the command of its
part (section 2); its section gives the check or the proof file.

### 8.2 Verdict

**No-go for phase 37 until PRs 1 to 5 of section 9 are merged. Go after that; the rest can be
fixed alongside it.**

What blocks:

- **A-2 (critical).** With delivery trucks loaded every day, the stock of each delivery truck
  and of the dépôt principal is wrong after the first delivery. Phase 37's fill rate and
  per-truck sales read exactly those figures.
- **A-1, A-3, C-1: `Visit.vehicleId` can disagree with the dépôt its sale left**, and a truck
  can be "driven" by someone who left. A statistic per vehicle built today would be wrong for
  those rows.
- **B-4 (high by the owner):** a replayed driver change undoes a later one. The driver history
  is what phase 37 reads to say who was on which truck.
- **B-1, B-2:** a manager limited to one dépôt can write onto trucks and routes of another. No
  figure is corrupted, but a tournée or a driver moves behind the back of the dépôt that owns
  it. Fix it before phase 37 adds per-dépôt vehicle screens.

What phase 37 can build on:

- `vehicle_assignments`, `Route.vehicleId` and `Order.vehicleId` behaved as specified in every
  path tried (part A), under 20 rounds of each race (part C), and across companies (part B: no
  row of another company is readable or writable through any new route, filter or body field,
  and the Essentiel gate holds).
- **History before phase 36 can be trusted** (part D): the backfill writes the truck only where
  a sale or a BL left one, never today's driver, leaves the rest null, is exact on 50 000 rows
  and changes nothing on a second run. Phase 37 must show the null rows as "Véhicule inconnu"
  and not count them per truck.
- **The screens hold** (part E): every phase 36 screen and sheet works at 360 and 393 px in
  Arabic and French and at 1280 px, with no sideways scroll, no raw key in ar / fr / en, no page
  error and no 5xx in 75 runs. The codes the owner named (`VAN-28 MXT 01`, `VAN34-SELF/MT`,
  `LIV 28 MIX`) and the plates keep their order everywhere they are drawn, measured and read
  by eye. Nothing in part E blocks phase 37. Its three findings are about how unusual codes are
  drawn (E-1, E-2) and one cut line (E-3); phase 37's per-vehicle screens should reuse
  `VehicleCode` only once E-2 is decided, because every report row will show a code.

Production:

- **Neon is migrated, and in the right order** (owner, 12.5): `20261114232622` was applied on
  2026-11-15 07:43 UTC, before the merge. D-1 therefore did not happen in production. The runbook
  still tells the next person the wrong order with commands that reach the local database (D-1,
  D-2): PR 0 stays first.

## 9. Fix plan (small PRs, in order; none is opened)

| # | PR | Findings | Test that locks it |
|---|---|---|---|
| 0 | Docs only, first: the phase 36 runbook block and README line say "migrate **before** the API deploys" (as `Migrations on Neon` already does), name `DATABASE_URL_MIGRATE` / `DATABASE_URL` on every command, and warn that a vehicle route breaks the tournée screens of a web still on the old version | D-1, D-2, D-3 | `e2e/test-36/part-d.sh` step 2b (new API on the pre-36 schema: 6 reads answer 500) stays as the proof of why; a docs review. |
| 1 | A delivery BL leaves the delivery truck (`deliveryVehicleId` wins over `order.warehouseId`); the rule written in `docs/domain.md` | A-2 | The A7 check "the BL of an order put on a loaded delivery truck leaves that truck", plus load 100 / deliver 6 / unload as an integration test. |
| 2 | Every way a driver stops driving goes through `assignDriver`: truck switched off, user deactivated, role that cannot drive | A-1, A-3 | The two A3 checks and the A8 check, plus the SQL rules `driver_is_a_live_user_who_may_drive` and `visit_sale_left_the_truck_frozen_on_the_visit` as an integration test. |
| 3 | One truck reach for every planner write: the freed truck of a driver move and the target truck of a convert are checked with `assertPlanned` before anything is written | B-1, B-2 | The three B2 checks "the Batna manager puts seller1…", "…converts seller1's old route", "…bulk-converts". |
| 4 | `@Idempotent()` on the driver change and both converts | B-4 | The B6 check "replayed … after a later change". |
| 5 | A visit linked to a sale freezes the truck the sale left (the history only when it has no sale) | C-1 | The C3 check "the field flow … the visit and the stock name the same truck", plus the A10 SQL rule `visit_sale_left_the_truck_frozen_on_the_visit`. |
| 6 | The driver-change guard looks at the cash since the last clôture, not at one session row | A-4 | The A8 check "cash responsibility after the move". |
| 7 | Truck history read by planners and the driver only | B-3 | The B2 check "truck history…". |
| 8 | Codes and plates: refuse C0 controls, bidi controls and zero-width characters; one script direction per code, or the code drawn part by part (owner's choice, E-1); codes compared as text (`lower(code) =`), search escaped | B-5, E-1, A-5, A-7 | The two B5 checks, the two "compared as text" checks, the search check, and the part E test "bidi: a code with an Arabic word…". |
| 9 | `VEHICLE_FIELDS_ON_DEPOT` at creation; code helper past 99; one reach rule for a supervisor's team trucks; the route edit locks its row before reading it | A-6, A-8, B-6, C-2 | The two A2 checks, the B2 INFO line on VAN turned into an assertion, the C4 check "bulk convert racing a move…". |
| 10 | The backfill's order fallback: either fill a visit from its order's dépôt when it is a truck (if the owner calls that a fact), or drop "else the order's" from the spec and the runbook | D-4 | `e2e/api/vehicles-backfill.ts`, row `visit_order_on_his_truck` turned into the chosen assertion. |
| 11 | `VehicleCode` never hides part of a code: it wraps or shrinks on the card instead of truncating, carries the full code as `title`, and the order row puts the truck on its own line on a phone | E-2, E-3 | The part E tests "long codes: two 30-character codes…" and "bidi: VAN-28 MXT 01…" (its "cut by the line" assertion on `/commandes`). |

Order: **PR 0 first**, before any other deploy. **PRs 1 to 5 before phase 37 starts** (PR 5 can
ship with PR 2: both make one definition of "the truck he was on"). PRs 6 to 11 can go alongside
phase 37; PR 11 should land before phase 37's first per-vehicle screen.

## 10. Part B: scope, isolation and security

**Suite:** `e2e/api/vehicles-scope.ts`, run with `pnpm test:vehicles:scope` (section 2). Every run
makes three new companies through the real API, every user invited with `POST /users/invite`:

- **S** (Distribution), the cast of the prompt: an owner; a manager limited to "Dépôt Batna"
  (phase 24 `OPERATE`, written with `PUT /users/:id/access`) and a second manager; a supervisor
  limited to Batna whose team is seller1, seller2 and seller4; seller3 outside the team; two
  livreurs; a storekeeper. Six trucks: `VAN-28 MXT 01` (principal, seller1), `PRV05-DD01` (Batna,
  seller2), `LIV 28 MIX` (principal, livreur1), `VAN34-SELF/MT` (Batna, seller3), `LIV 05 MIX`
  (Batna, livreur2), `SANS TYPE` (principal, nobody). One vehicle route per truck, one old seller
  route per seller, a confirmed order of the Batna dépôt.
- **B** (Distribution): the same type codes (`MXT`, `MIX`) and truck codes, a driver on each truck,
  a seller route, a vehicle route, an order on its delivery truck. Every name and plate of B
  carries the marker `TENANTB`: no answer given to S may contain it.
- **E** (Essentiel): an owner and a seller.

Expected sets of ids come from SQL in the suite (`truthVehicles` / `truthRoutes`, the rule of
`tournee-scope.ts` written as joins on `warehouses`, `user_warehouse_access` and
`users."managerId"`), never from the service under test. Proofs: `artifacts/test-36/vehicles-scope.{md,json}`
(every check), `vehicles-scope-isolation.txt` (every cross-tenant answer),
`vehicles-scope-gate.txt`, `vehicles-scope-hostile.txt` (101 hostile requests and their answers).

### 10.1 Results

| Area (`T36_ONLY=`) | Checks | Pass | Fail | Notes | Findings |
|---|---|---|---|---|---|
| B1 tenant isolation (`isolation`) | 46 | 46 | 0 | 0 | |
| B2 scope inside a tenant (`scope`) | 32 | 24 | 4 | 4 | B-1, B-2 (2 checks), B-3; B-6 from the notes |
| B3 permissions (`permissions`) | 6 | 5 | 0 | 1 | |
| B4 feature gate (`gate`) | 18 | 18 | 0 | 0 | |
| B5 hostile input (`hostile`) | 4 | 1 | 2 | 1 | B-5 (2 checks) |
| B6 idempotency and audit (`idempotency`) | 8 | 4 | 1 | 3 | B-4 (high) |
| B7 production, anonymous GET (`production`, with `PROD_API`) | 3 | 3 | 0 | 0 | |
| **Total** | **117** | **101** | **7** | **9** | **6 findings** |

The check functions that only write an INFO line count as a pass in the "Pass" column; the
"Notes" column counts the INFO lines themselves.

`git diff --stat origin/main -- apps packages` is still empty.

### 10.2 What the prompt asked to be said in words

- **Who may call `POST /warehouses/:id/driver`:** owner, manager, supervisor (`@Roles`), each for
  the trucks of his reach (`assertPlanned`). Seller, livreur and storekeeper get 403 and nothing
  is written. A supervisor only puts people of his team on a truck (403 `FORBIDDEN` for seller3
  or a livreur, even on a Batna truck). He may take seller3 off a Batna truck, because the rule
  gives him the trucks of the dépôts he operates.
- **`SETTINGS_EDIT` for types:** supervisor, seller, livreur and storekeeper get 403 on create,
  update and archive. Every role may list them (pickers). A manager has `SETTINGS_EDIT` by
  default, so the Batna manager creates company-wide types (201). That is the existing role
  matrix, not new in phase 36.
- **User history:** the user himself, owner, managers (every user, even one limited to a dépôt;
  trucks outside his dépôts come back with `inReach: false`) and a supervisor for his team. A
  seller, a livreur and the storekeeper get 403 on anyone else; a supervisor gets 403 on seller3.
  The **truck** history follows another rule (B-3).
- **Report `?by=vehicle`:** for the supervisor, the Batna manager and seller1, every row is a
  truck of the SQL reach, and `?vehicleId=` of a truck outside it gives no row.
- **Lists:** `GET /routes` returns exactly the SQL set of ids for the owner, the Batna manager,
  the supervisor, seller1, seller3, livreur1 and the storekeeper (nothing for the storekeeper).

### 10.3 What holds up well

- **Tenant isolation, everywhere tried (46 checks).** S was given B's ids in the path of every new
  route (types, trucks, driver, truck history, user history, routes, convert, orders), in every
  new body field (`vehicleTypeId`, `assignedUserId`, `parentWarehouseId`, `userId`, `vehicleId`,
  `sellerId`, `deliveryVehicleId`, `livreurId`, plus `warehouseId` of an order, a quick sale and a
  chargement), in every new filter (`vehicleTypeId`, `vehicleId`, `deliveryVehicleId`, the report)
  and as a pagination cursor. Each answer is 4xx or an empty list, and none holds `TENANTB`. A hash of B's
  `vehicle_types`, `warehouses`, `vehicle_assignments`, `routes`, `route_stops`, `orders`,
  `visits`, `stock_movements` and audit ids is the same after all of it. B's drivers are
  unchanged and its trucks have only their creation rows.
- **Same codes never collide:** `search=VAN-28 MXT 01` and `LIV 28 MIX` return S's truck only, the
  type list is exactly S's (SQL), B creates a code S already has. A bulk convert in S leaves B's
  seller route alone.
- **Feature gate (18 checks):** on Essentiel, every type route, the truck identity on create and on
  the dépôt principal, the driver change, both histories (also the seller's own), vehicle routes,
  both converts, the vehicle report and the truck filters of orders and visits answer 403 before
  any lookup. `GET /warehouses` still answers, and no phase 36 row was written.
- **No 500 on hostile input (101 requests):** 10 000-character text, NUL, controls, lone
  surrogates (in JSON and as raw CESU-8 in the query), bidi and zero-width characters,
  `wilayaCode` / `capacityKg` as string, float, `1e20`, `-1`, boolean, array, object, 2^53+1, bad
  uuids, `limit` 0 / 101 / `1e999`, a broken JSON body, an array or `null` body, no body. NUL and
  lone surrogates are refused everywhere with 400 `VALIDATION_FAILED` ("Invalid characters", the
  audit 02 B-4 fix). The rest are 400 from zod.
- **Scope of the edit paths:** a supervisor gets 404 on GET, PATCH, PUT stops, convert and DELETE of
  a route outside his reach, and on a driver change of such a truck; nothing is written. The
  Batna manager gets 404 on the dépôt form of a principal truck (PATCH code, PATCH driver, DELETE)
  and on its driver change. Assigning an order to a delivery truck outside the reach is refused
  for both.
- **Audit:** `VEHICLE_TYPE_CREATED / UPDATED / ARCHIVED`, `WAREHOUSE_CREATED / UPDATED` (identity
  in before and after), `VEHICLE_DRIVER_CHANGED`, `ROUTE_CONVERTED`, `ORDER_LIVREUR_ASSIGNED` each
  write one row with the user, and before / after where something changes.
- **Replays without a later change:** the same driver change twice with one key writes one row;
  convert one twice and bulk twice write no second `ROUTE_CONVERTED` (the second bulk says 0).
- **Production:** `GET /vehicle-types`, `/warehouses/:id/assignments` and
  `/users/:id/vehicle-assignments` without a token answer 401 on `erp-saas-pi.vercel.app`. These
  three requests are the only ones sent to production in this test.

### 10.4 Findings

Part B: **0 critical, 3 high, 2 medium, 1 low.** B-4 is high by the owner's decision of
2026-11-15 (it was first written as medium).

#### B-1 (high) A manager limited to one dépôt takes a driver off a truck of another dépôt

- **Rerun:** `T36_ONLY=scope pnpm test:vehicles:scope`, check "the Batna manager puts seller1 (who
  drives VAN, a truck of the principal) on a Batna truck…".
- **Path:** seller1 drives `VAN-28 MXT 01` (dépôt principal). The manager who works in Batna only:
  `POST /warehouses/<LIV 05 MIX, Batna>/driver {"userId": seller1}` → **200**.
- **Expected:** refused. `tournee-scope.ts` gives a manager "the trucks of the dépôts he works in",
  and the same manager gets 404 for `POST /warehouses/<VAN>/driver` and for the dépôt form of VAN.
- **Actual:** VAN loses its driver: `assignedUserId` null and a second `vehicle_assignments` row
  naming nobody, set by the Batna manager. The tournée of VAN has nobody on it from now on, and
  the principal dépôt is not told.
- **Cause:** `VehiclesService.changeDriver` checks the reach of the target truck only
  (`assertPlanned`, `apps/api/src/stock/vehicles.service.ts:347`). `assignDriver` then frees the
  driver's other truck (`other`, `:276`, written at `:306`) with `moveDriver: true` (`:360`) and
  never asks whether the caller reaches it. A supervisor cannot do this: his team's trucks are
  always in his reach. Only a manager (or anyone whose reach is a dépôt list) can.
- **Fix proposal:** in `changeDriver`, when the new driver has another truck, `assertPlanned` it
  too (or answer `VEHICLE_ALREADY_ASSIGNED` with its name, as the dépôt form does) before
  anything is written. Lock with the check above.

#### B-2 (high) Convert puts a seller route on a truck outside the planner's reach, and convert-one writes while answering 404

- **Rerun:** `T36_ONLY=scope pnpm test:vehicles:scope`, checks "the Batna manager converts
  seller1's old route…" and "the Batna manager bulk-converts…".
- **Path:** the Batna manager `POST /routes/<seller1's seller route>/convert-to-vehicle` →
  **404 `ROUTE_NOT_FOUND`**. Then, from the same state, `POST /routes/convert-to-vehicle` →
  `{"converted": 3, "skipped": 1}`.
- **Expected:** refused, or that route skipped, as for an edit: the same manager gets 404 for
  `PATCH /routes/:id {"vehicleId": VAN}` (control check, passes).
- **Actual:** the route is now on VAN (dépôt principal) with a `ROUTE_CONVERTED` audit row naming
  the Batna manager. On convert-one he was told "not found" and the write had committed: the
  route then vanishes from his own list, and seller1 sees it under his truck. The bulk convert
  moves it the same way.
- **Cause:** a manager reaches every seller route (`tourneeSellerIds` returns null for MANAGER,
  `apps/api/src/tournees/tournee-scope.ts:21`), so `live()` lets him open the route. `convert()`
  (`apps/api/src/tournees/routes.service.ts:258`) gives it its seller's truck without checking
  that truck against `reach.vehicleIds`, unlike `resolveOwner` (`:301-302`). `convertToVehicle`
  re-reads the route with the caller's reach after commit (`:239`), hence the 404 after the
  write.
- **Fix proposal:** in `convert()`, skip (count as `skipped`) a route whose truck is outside the
  caller's truck reach; in convert-one, answer `WAREHOUSE_NOT_FOUND` before writing. Lock with
  the two checks.

#### B-3 (medium) Every user of a dépôt reads who drove each of its trucks, while the user history refuses him

- **Rerun:** `T36_ONLY=scope pnpm test:vehicles:scope`, check "truck history: a seller reads his own
  truck's (200), not another truck's (404)…".
- **Path:** `GET /warehouses/<truck>/assignments` as seller1 on `LIV 28 MIX` and `SANS TYPE`, as
  seller3, livreur1 and the storekeeper on `VAN-28 MXT 01`.
- **Expected (prompt):** "a seller cannot … read another seller's vehicle history".
  `GET /users/:id/vehicle-assignments` answers him 403 for anyone else.
- **Actual:** 200 for each, with the names, dates and who set them (seller3 reads three rows naming
  seller1). It is the same information as the user history, read truck by truck.
- **Cause:** the truck history is open to "whoever sees the truck (dépôt reach)",
  `statsWarehouseIds` (`apps/api/src/stock/vehicles.service.ts:506-515`). Every invited user gets
  `OPERATE` on the dépôt principal by default (seen in `user_warehouse_access`), so the trucks of
  the principal are in everyone's stats reach.
- **Why medium and not high:** the rule is written on purpose in the code, and the data is names
  and dates, no figure. It is still a scope rule the prompt states, broken from inside the
  company. The owner may rate it high.
- **Fix proposal:** the truck history for planners in reach (`plannedVehicleIds`) and for the
  truck's current driver only. Lock with the check above.

#### B-4 (high, by the owner) A driver change replayed after a later change puts the old driver back

- **Rerun:** `T36_ONLY=idempotency pnpm test:vehicles:scope`, check "a driver change replayed with
  its Idempotency-Key after a later change…".
- **Path:** on one truck: X with key K (200); then Y with another key (200); then the request with
  K again (a phone retrying after a lost answer).
- **Expected:** the original answer, no row, Y stays. AGENTS §3.6 (a replay returns the original
  response), prompt part B ("a replayed driver change or convert does not write a second row").
- **Actual:** 200 without `Idempotent-Replayed`, a fifth history row, and **X drives the truck
  again**. A later decision is undone silently, and the next sale of X or Y takes stock from
  the truck the planner did not choose.
- **Cause:** `POST /warehouses/:id/driver` and both converts have no `@Idempotent()`
  (`apps/api/src/stock/warehouses.controllers.ts:79`, `apps/api/src/tournees/tournees.controllers.ts:123`, `:131`);
  the global interceptor only acts on marked routes. Convert is harmless here (a converted route
  is not converted again), the driver change is not.
- **Owner's decision (2026-11-15):** high. A phone retrying after a lost answer is the normal
  case on a weak network, and the result is a truck handed back to the wrong person with the
  stock and the cash of the next sales following him.
- **Fix proposal:** `@Idempotent()` on the driver change (and on the converts for the uniform
  answer). Lock with the check above.

#### B-5 (medium) Codes and plates keep control, bidi and zero-width characters: two trucks show as `VAN-28 MXT 01`

- **Rerun:** `T36_ONLY=hostile pnpm test:vehicles:scope`, the two checks "nothing invisible or
  reordering … is stored…" and "two trucks that look the same…".
- **Path:** `POST /warehouses` / `PATCH /warehouses/:id` with `code` and `plateNumber`, and
  `POST /vehicle-types` with `code` and `codePrefix`, set to `VAN\u0007\u001b 01`, `VAN\n01`,
  `VAN-28 ‮10 TXM`, `⁧VAN-28⁩ 01`, `VAN-28‏ MXT 01`, `VAN-28 MXT 01​`;
  the same text as the `reason` of a driver change.
- **Expected (prompt):** 400 for control characters and RTL override characters in a code or plate.
- **Actual:** 201 / 200, and 28 values stored as typed (list in the check). Two live trucks of the
  company have codes that read `VAN-28 MXT 01` on screen next to the real one, accepted by
  the uniqueness check. The U+202E code shows as `VAN-28 MXT 01` in a left-to-right list. The
  reasons sit in `vehicle_assignments`, which can never be corrected. A BOM is stripped by the
  trim (stored `VAN 02`).
- **Cause:** `nullableText` and the type `code` only `trim()` and check the length
  (`packages/shared/src/schemas/vehicles.ts:9-15`, `:26`). The global pipe refuses NUL and lone
  surrogates only.
- **Fix proposal:** one shared refinement for codes, prefixes and plates: refuse C0/C1 controls,
  U+200B–U+200F, U+202A–U+202E, U+2066–U+2069 and U+FEFF (400 `VALIDATION_FAILED`), and the
  same on the driver-change reason, line feed included. Lock with the two B5 checks. Arabic letters and spaces
  stay allowed (A2 already checks them).

#### B-6 (low) Three reach rules for one supervisor's team truck

- **Rerun:** `T36_ONLY=scope pnpm test:vehicles:scope`, INFO line "supervisor and VAN (team truck of
  the principal)…".
- **Path:** the supervisor (Batna) and `VAN-28 MXT 01` (principal, driven by seller1 of his team).
- **Actual:** he may change its driver and plan its tournée (`tourneeVehicleIds`), but
  `PATCH /orders/:id/livreur {"deliveryVehicleId": VAN}` and `GET /warehouses/VAN/assignments`
  answer 404 `WAREHOUSE_NOT_FOUND`. The order uses `scope.assertWarehouse`
  (`apps/api/src/tournees/orders.service.ts:323`, `warehouseIds`), the history uses
  `statsWarehouseIds` (`vehicles.service.ts:507`).
- **Effect:** no data wrong, no leak. A screen offering "Changer" on a truck then shows "not found"
  on its history. Phase 37's per-truck screens will meet the same question.
- **Fix proposal:** one function for "trucks a planner reaches" (`plannedVehicleIds`) used by the
  driver change, the tournée, the delivery truck of an order and the truck history.

### 10.5 Notes (seen, not counted as findings)

- A supervisor takes seller3 (not in his team) off a Batna truck (200): what the rule says.
- The Batna manager reads the worker history of any user; trucks outside his dépôts come back
  with `inReach: false`. Managers see every seller in the tournée rules too (phase 16).
- The Batna manager creates vehicle types (company-wide) through `SETTINGS_EDIT`.
- Invited users (sellers, livreurs, storekeeper) start with `OPERATE` on the dépôt principal; the
  sellers moved onto a Batna truck also hold Batna. This is the phase 24 default, and it is what
  makes B-3 reach every principal truck.
- A seller naming a truck he no longer drives as `warehouseId` of a sale (part A note): the truck
  stays inside his company and his dépôt reach, so it is not a tenant or scope leak. Whether a
  seller may sell from a truck he does not drive is a phase 15 rule, not phase 36.
- The prompt's "a route with neither vehicle nor seller refused" and the RLS checks were done in
  part A (A6, A5) and are not repeated.

### 10.6 Suspected, not proven

- An owner-granted `VIEW_ALL_WAREHOUSES` on a supervisor would make his truck reach "all"
  (`tournee-scope.ts:81`) while his seller reach stays his team. That is not tried here (no such
  grant in the cast), and it may be intended.

### 10.7 Part B: what was not tested, and why

- **Races** of a driver change against a convert or a sale: part C.
- **`VIEW_ALL_WAREHOUSES` granted to a manager or supervisor**, and a manager without any dépôt
  row: not in the prompt's cast; the code path is one line (`tournee-scope.ts:81`).
- **The web app's own scope** (what the screens offer to each role): part E. This part checks the
  API, which is the source of truth (AGENTS §4).
- **The Neon / production data:** never touched; only the three anonymous GETs.

## 11. Part C: concurrency

**Suite:** `e2e/api/vehicles-race.ts`, run with `pnpm test:vehicles:race` (section 2), about 15 s.
Each area makes its own company (DISTRIBUTION, every user invited with `POST /users/invite`) and
fires the racing requests with `Promise.all`, **20 rounds** each (`T36_ROUNDS=`). The API was
restarted fresh on `erp_t36` before the run. Each round is judged with SQL on the database, not
on the answers: per company, (1) each truck's last `vehicle_assignments` row names its
`assignedUserId`, (2) no user drives two live trucks, (3) no truck has two rows in a row naming
the same person (a doubled row) and the number of rows grew by exactly the number of accepted
changes (a lost row). PostgreSQL's own log (`docker logs erp-saas-db-1`) is read for
`deadlock detected` / `could not serialize` after C1 and C2.

Proofs: `artifacts/test-36/vehicles-race.{md,json}` (every check),
`vehicles-race-drivers.txt` (each round of C1 and C2: answers, end drivers, row counts),
`vehicles-race-sale.txt` (each round of C3: truck left, truck frozen),
`vehicles-race-convert.txt` (each round of C4: answers, end route, audit), `reconcile-race.txt`.

### 11.1 Results

| Area (`T36_ONLY=`) | Checks | Pass | Fail | Notes | Findings |
|---|---|---|---|---|---|
| C1 same truck (`same`) | 4 | 4 | 0 | 0 | |
| C2 cross moves (`cross`) | 3 | 3 | 0 | 1 | |
| C3 sale / visit vs driver change (`sale`) | 4 | 3 | 1 | 2 | C-1 |
| C4 bulk convert vs route edit (`convert`) | 2 | 1 | 1 | 1 | C-2 |
| Reconcile after part C | 1 | 1 | 0 | 0 | |
| **Total** | **18** | **12** | **2** | **4** | **2 findings** |

Like the other suites the "Pass" column holds the INFO lines too (`18 checks · 12 passed · 2
failed` on the last line, plus 4 INFO). `reconcile`: "Ledgers reconciled: no difference".
`git diff --stat origin/main -- apps packages` is still empty.

### 11.2 What the prompt asked to be said in words

- **Two driver changes on one truck at once (C1, 20 rounds × 3 shapes):** both answer 200 and
  the second one wins, each writing its row (two people with no truck); or one answers 409
  `VEHICLE_ALREADY_ASSIGNED` (one person put on two trucks at once, with or without a truck
  already: the partial unique index on `assignedUserId` catches the loser, mapped from P2002 at
  `vehicles.service.ts:319`). Two drivers who each have a truck moved onto the same truck:
  both answer 200, both old trucks are freed with their rows, the second one ends on the truck
  and the first one drives nothing, exactly as if the two changes had been made one after the
  other. Nobody ever drives two trucks. Every round: the last row equals
  `assignedUserId`, rows grew by the number of accepted changes, no 500.
- **Cross moves (C2):** A (truck 1) → truck 2 and B (truck 2) → truck 1 at once: **20 of 20
  rounds swap**, both 200, 3 or 4 rows per round as the freed trucks require, no deadlock. A
  three-way rotation (A→2, B→3, C→1 at once) also never deadlocks nor answers 500. The single
  `SELECT … ORDER BY id FOR UPDATE` over the target truck and the driver's current truck
  (`vehicles.service.ts:257-265`) does what its comment says; PostgreSQL logged no deadlock.
- **A driver change racing a sale by the old driver (C3a):** the sale always takes exactly one
  truck, one of his two, and `Sale.warehouseId` equals the truck its `SALE` movements left. In
  this run the move committed first in all 20 rounds, so the sale left the new truck each time.
  Never stock from one truck and the sale booked on the other.
- **A driver change racing a visit start (C3b):** the visit freezes one of his two trucks, always
  the one the history gives at its `startedAt` (checked with SQL). Consistent.
- **The two together (C3c), the case the prompt names:** the visit is stamped `startedAt` when
  the seller opens the client, the sale is then sent, then the visit with that `saleId`, while
  the planner moves him: **20 of 20 rounds put the stock on one truck and the visit on the
  other** (finding C-1).
- **Bulk convert racing a route edit (C4):** a rename never loses the convert, nor the convert
  the name. A move of the same route to another seller overwrites a convert that had already
  committed, from what it read before (finding C-2).

### 11.3 What holds up well

- **The driver history under load.** 120 racing driver changes over C1 and C2, and not one round
  leaves a truck whose last row disagrees with its driver, a driver on two trucks, a row lost or
  doubled, a 500 or a deadlock.
- **One driver, one truck** is held by the database (partial unique index), not only by the
  service check, and the loser gets the documented 409.
- **Stock under the race:** after C3 the dépôt principal and both trucks equal the sum of their
  movements, nothing went negative, and the repo's `reconcile` finds no difference.
- **Convert locks in id order** (`routes.service.ts:260-265`) and re-reads `vehicleId IS NULL`
  under the lock: a route an edit had already put on a truck is never converted twice.

### 11.4 Findings

Part C: **0 critical, 0 high, 1 medium, 1 low.**

#### C-1 (medium) A sale and its visit split over two trucks when the driver changes during the visit

- **Rerun:** `T36_ONLY=sale pnpm test:vehicles:race`, check "the field flow (visit opened on the
  phone, then the sale, then the visit sent with the sale) racing his move…".
- **Path:** seller X drives `SALE 01`, `SALE 02` is free, both loaded with 200. The phone stamps
  `startedAt`. At once: X `POST /sales/quick` (no dépôt) then `POST /visits {startedAt, outcome:
  SALE, saleId}`, and the owner `POST /warehouses/<SALE 02>/driver {"userId": X}`.
- **Expected (prompt, part C):** "which truck do the sale and the visit get? It must be one of the
  two consistently, never stock from one truck and `vehicleId` of the other."
- **Actual:** 20 of 20 rounds: the stock left the **new** truck (`Sale.warehouseId` = the new
  truck) and `Visit.vehicleId` = the **old** truck (e.g. round 0: stock left `17998b94`, visit
  `c0e6279e`, in `vehicles-race-sale.txt`). The race is not even needed: any move that lands
  between the moment the seller opens the client and the moment he sells does it.
- **Cause:** the same two definitions of "his truck" as A-1. `VisitsService.create` freezes the
  history at `startedAt` (`vehicleOfUserAt`, `apps/api/src/tournees/visits.service.ts:88`) and
  never looks at the linked sale; the sale takes the truck he drives at validation
  (`currentVehicleOf` through `WarehousesService.vehicleOf`, `apps/api/src/stock/warehouses.service.ts:126`,
  used at `apps/api/src/sales/sales.service.ts:81`).
- **Why medium and not high:** every ledger is right (reconcile clean, each truck equals its
  movements) and a session left open would have blocked the move (`SESSION_OPEN_ON_VEHICLE`).
  What is wrong is the column phase 37 groups by: a per-vehicle count of visits with a sale would
  give the old truck a sale whose goods left the new one. The A10 SQL rule
  `visit_sale_left_the_truck_frozen_on_the_visit` of part A flags these rows.
- **Fix proposal:** a visit linked to a sale (or an order delivered from a truck) freezes the
  dépôt the sale left when it is a truck; the history at `startedAt` only when there is no such
  link. Lock with the C3c check and the A10 SQL rule as an integration test.

#### C-2 (low) A route edit overwrites a convert that committed under it, and its audit "before" is wrong

- **Rerun:** `T36_ONLY=convert pnpm test:vehicles:race`, check "a bulk convert racing a move of the
  same seller route to seller2…".
- **Path:** seller route R of seller1 (who drives `CONV 01`); seller2 drives none. At once:
  `POST /routes/convert-to-vehicle` and `PATCH /routes/R {"sellerId": seller2}`.
- **Expected:** one decision, and an audit that tells the truth. Done one after the other, the
  same two requests leave R **on the truck** (the edit then sees a vehicle route, and "a vehicle
  wins over a seller", `routes.service.ts:182-188`).
- **Actual:** 20 of 20 rounds: convert answers `{"converted": 1}` and writes `ROUTE_CONVERTED`
  (R on `CONV 01`); then the edit lands and R ends on **seller2** with `vehicleId` null. Its
  `ROUTE_UPDATED` row says `before.vehicleId: null`, while R was on the truck at that moment.
  The end state depends on timing, and the audit trail shows a convert then an edit "from a
  seller route".
- **Cause:** `RoutesService.update` reads the route with `live()` (no lock,
  `apps/api/src/tournees/routes.service.ts:181`), decides the owner from that read, then writes
  (`:193`) after waiting for convert's row lock. `setStops` already takes `FOR UPDATE` before it
  reads (`:325-328`); `update` does not.
- **Why low:** no figure, no scope: the end state is one the planner asked for, the CHECK holds,
  and both writes are audited. Only the "before" is false and the result depends on timing.
- **Fix proposal:** in `update` (and `archive`), lock the route row with `SELECT … FOR UPDATE`
  before `live()` reads it, as `setStops` does. Lock with the C4 check.

### 11.5 Notes (seen, not counted as findings)

- C3a: the racing sale left the new truck in 20 of 20 rounds (the driver change is the shorter
  transaction). With the order reversed the sale would leave the old truck; both are consistent.
- C4b: convert committed first in every round; the edit always won afterwards.
- The driver change has no idempotency key (B-4); part C sends none, so each racing request is a
  distinct decision.
- C1b: when two drivers who each have a truck race for a third, both old trucks are freed and
  the first mover ends with no truck (`vehicles-race-drivers.txt`). That is the sequential
  result; a planner gets no warning that his change was replaced a moment later.

### 11.6 Part C: what was not tested, and why

- **A driver change racing a chargement / déchargement or a clôture** (seller session open/close):
  not in the prompt's list. The guard runs inside the driver-change transaction but reads
  `seller_sessions` without a lock; a session opened in the same instant is not proved either way.
- **A driver change racing an order delivery** by the old livreur of a delivery truck: blocked by
  A-2 (the BL does not leave the truck at all), to retest after its fix.
- **More than one API process:** one Node process, one pool, as in production on one VPS. The
  locks are in PostgreSQL, so a second process should not change the results, but it was not run.

## 12. Part D: backfill and upgrade

**Script:** `e2e/test-36/part-d.sh` (section 2), about 2 minutes, local only. It drops and makes
again the scratch database `erp_t36_base`; it never touches `erp_t36`, the dev database `erp` or
Neon. Proofs are in `artifacts/test-36/part-d/`.

### 12.1 How the pre-36 world was made

A copy of a real pre-36 production database was not available, so the script builds one the way
production got it: **with the old code**.

1. **Old code.** The spare worktree `../erp-main` checked out at `93afa56` (main just before the
   PR #72 merge, last migration `20261113130000_livreur_scope`), `pnpm install`, `pnpm build`
   with `NEXT_PUBLIC_API_URL=http://localhost:3003`, and `apps/api/.env` copied from this checkout
   (the JWT secret; both files are git-ignored there). `versions.txt` records both commits.
2. **Pre-36 schema.** `erp_t36_base` migrated with the old checkout's migrations, plus the app
   role. `GET /vehicle-types` answers 404 on that API: the script checks it is the old one.
3. **History, through the old API** (`e2e/api/vehicles-backfill-seed.ts`, every user invited with
   `POST /users/invite`): company P (Distribution) with five sellers and five trucks; old seller
   routes; two visits linked to van sales (seller1 on T1); a visit linked to a sale from the dépôt
   principal; an order on T1 delivered from T1; an order with no dépôt delivered by seller1, whose
   BL the old rule took from **his truck** ("the order's dépôt, else the deliverer's truck");
   the prévendeur's order on his truck T2 delivered from it, with its visit; an order on the dépôt
   principal delivered from it, with its visit; a confirmed order never delivered; two visits with
   neither sale nor order. Then **today's crew is made different from the history's**: seller1
   moves to T3, T1 goes to seller3, T4 is archived with its driver, T5 is switched off with its
   driver. A backfill that guessed from today's driver would write T3 on seller1's visits.
   Company Q: one truck with a driver, one without.
4. **Volume** (`e2e/sql/vehicles-backfill-bulk.sql`, as the owner role, copies of real rows):
   25 000 visits linked to the van sale, 25 000 visits with neither, 50 000 confirmed orders on
   the dépôt principal. In all 50 007 visits and 50 005 orders.

Each row's expected truck is written in `.auth/vehicles-backfill-fixture.json` twice: what the
spec's rule gives (`spec`) and what a person could prove from the rows (`facts`).

### 12.2 Results

| Step | Result | Proof |
|---|---|---|
| Migration lock time, 50 000 visits / orders | 37 statements, **170 ms** in one transaction (as Prisma applies it); slowest the two new indexes on `orders` (48 ms) and `visits` (41 ms). `prisma migrate deploy` for real: 1 s. | `migration-lock.txt`, `migrate-deploy.txt` |
| Locks held until the end of that transaction | `AccessExclusiveLock` on `warehouses`, `routes`, `visits`, `orders`: a read and an insert on `visits` from a second connection wait (300 ms lock timeout hit). For 0.2 s here; it grows with the index builds. | `migration-lock.txt` |
| Initial driver history (in the migration) | One `backfill` row for each of the 5 live trucks with a driver (T1 seller3, T2, T3 seller1, T5 switched off, Q1), naming **today's** driver, `fromAt` = the truck's `updatedAt`, `setBy` null; none for T4 (archived), Q2 (no driver), the dépôt principal. | `backfill.md` |
| `db:backfill-vehicles` run 1 | "Visits given their truck: **25 002**. Delivered orders given their delivery truck: **3**." in 2.0 s over 2 companies. Both equal the SQL count of facts (visits whose sale left a truck, orders whose BL left one). | `backfill.txt` |
| Each history row | 12 / 12 as the spec says: both van-sale visits get T1 (seller1 drives T3 today: **not guessed**); the three BLs from a truck give their truck, the order delivered by seller1 included; the sale from the dépôt principal, the order on the dépôt principal and its visit, the undelivered order and both visits with neither stay null. | `backfill.md` |
| Truth SQL (`e2e/sql/vehicles-backfill.sql`) | 8 rules, 0 rows each: assignment missing / wrong / where none is due; visit truck ≠ the truck its sale left; visit truck with no fact; order delivery truck ≠ its BL's truck; delivery truck with no fact; truck of another company. | `backfill-truth.txt` |
| Run 2 | 0 and 0, in 1.0 s; an md5 of every `visits.vehicleId`, `orders.vehicleId`, `orders.deliveryVehicleId` is the same as after run 1. | `backfill.md` |
| `reconcile` after migration and backfill | "Ledgers reconciled: no difference". | `reconcile.txt` |
| Old API, migrated schema (migrate first, deploy after) | 11 reads, 0 errors; the **old** Playwright desktop suite with the old web on top: **12 / 12 passed**. | `api-schema-probe.txt`, `old-web-old-api-migrated.txt` |
| New API, pre-36 schema (deploy first, migrate after) | **6 of 11 reads answer 500**: `/warehouses`, `/warehouses/:id`, `/routes`, `/me/today`, `/orders`, `/visits` ("The column `warehouses.code` does not exist", `routes.vehicleId`, `orders.vehicleId`, `visits.vehicleId`). Finding D-1. | `api-schema-probe.txt` |
| Old web, new API, no vehicle route yet | Old desktop suite: **12 / 12 passed**. | `old-web-new-api.txt` |
| Old web, new API, one vehicle route in the data | `/tournees` and `/tournees/:id` **crash** ("This page couldn't load"); the five other screens tried load. Finding D-3. | `old-web-vehicle-route.txt`, `old-web-tournees.png`, `old-web-tournee-vehicule.png` |

### 12.3 What the prompt asked to be said in words

- **The backfill never guesses.** Seller1 drove T1 when he made his visits and drives T3 today:
  his van-sale visits get T1 (from the sale), his visits with neither stay null, none gets T3. The
  rule "the sale's dépôt when it is a truck, else the order's; the BL's dépôt when it is a truck"
  is applied exactly, on 50 000 rows as on 12.
- **The initial `vehicle_assignments` rows** follow the spec: one per live truck with a driver,
  `reason = 'backfill'`, `fromAt` = the truck's `updatedAt`. Note: a truck switched off with its
  driver kept (T5) gets a row too. That is the spec's wording ("every truck that has a driver
  today"), and the same state as A-1.
- **The migration on a live table:** every new column is nullable with no default, so adding it
  rewrites nothing; the CHECK constraints are on `warehouses` and `routes` (small tables); the
  cost is the four non-concurrent indexes, about 1 ms per 1 000 rows here. All locks are held for
  the whole file, because Prisma sends it as one multi-statement query (one implicit transaction):
  every read and write on `warehouses`, `routes`, `visits` and `orders` waits for that time. At
  this repo's production sizes that is well under a second.
- **Does the old web still work against the new API?** Yes as long as no route is a vehicle route:
  the old suite passes. As soon as one exists (made by the new web, or by "Convertir"), the old
  route list and route page crash: `Route.seller` became nullable, so the DTO change is not purely
  additive for routes. Every other screen tried loads.
- **README / runbook:** the Neon block is there (`docs/runbook.md` "Vehicle backfill",
  `README.md:86`) with `db:deploy`, build, backfill twice, reconcile, and it matches the CLI's
  output ("Visits given their truck: N…", second run 0 and 0). Two things in it are wrong: the
  order (D-1) and the commands name no database (D-2).

### 12.4 Findings

Part D: **0 critical, 1 high, 2 medium, 1 low.**

#### D-1 (high) The runbook deploys the API before the migration: the phase 36 API answers 500 on the dépôts, tournées, orders and visits until `db:deploy` runs

- **Rerun:** `OLD=../erp-main bash e2e/test-36/part-d.sh`, step 2b; the section
  "NEW API, pre-36 schema" of `artifacts/test-36/part-d/api-schema-probe.txt`.
- **Path:** the new API (`c06adf0`) started on the pre-36 database, owner token:
  `GET /warehouses`, `/warehouses/:id`, `/routes`, `/me/today`, `/orders?limit=5`, `/visits?limit=5`.
- **Expected:** the order in `docs/runbook.md:354` ("migrations are run by hand, **before** the API
  version that needs them goes live"), which the old API on the migrated schema shows is safe
  (0 errors, old suite 12 / 12).
- **Actual:** 500 `INTERNAL_ERROR` on all six ("The column `warehouses.code` does not exist", and
  `routes.vehicleId`, `orders.vehicleId`, `visits.vehicleId`). A seller cannot open his day, take
  an order or record a visit; the office cannot open the dépôts. Clients, products, sales and the
  dashboard still answer.
- **Cause:** the phase 36 block says to run it "after the merge" (`docs/runbook.md:324`), and
  `README.md:86` "After deploying phase 36, run … `db:deploy`". Vercel builds the API on the merge
  with no migration step (`apps/api/package.json` `build`, `apps/api/vercel.json`), and Prisma
  selects every column of the model. The phase 36 spec itself wrote "After merge: `db:deploy` on
  Neon" (`docs/prompts/phase-36-vehicle-first-distribution.md:60`).
- **Fix proposal:** docs only. Phase 36 block and README: run `db:deploy` on Neon **before** the
  merge reaches production, then build and backfill after it, as "Migrations on Neon" says.
  Keep step 2b of part D as the reason. The owner should check `_prisma_migrations` on Neon now (12.5).

#### D-2 (medium) The Neon commands of the phase 36 block name no database: as written they migrate and backfill the local one

- **Rerun:** read `docs/runbook.md:326-332` and `README.md:86` next to `docs/runbook.md:361`;
  `apps/api/prisma.config.ts:14-16`.
- **Expected:** every command that must reach Neon names it, as the phase 35 README entry does
  (`README.md:112-119`: `DATABASE_URL_MIGRATE='postgresql://<owner>…' pnpm … db:deploy`, owner
  role, direct host).
- **Actual:** `pnpm --filter @erp/api db:deploy`, `db:backfill-vehicles` and `reconcile` are given
  bare. The runbook's own warning applies: "Without the variable on the command line it migrates
  the **local** database and prints 'All migrations have been successfully applied'". The
  backfill and reconcile then read `DATABASE_URL` from `apps/api/.env` (the dev database) and
  print counts and "no difference" for it. Every step looks green and Neon is untouched; with
  D-1 that leaves production on 500s.
- **Fix proposal:** with D-1, in the same docs PR: write the variables on each line
  (`DATABASE_URL_MIGRATE` owner/direct for `db:deploy`; `DATABASE_URL` for the backfill and
  reconcile) and the `_prisma_migrations` check after.

#### D-3 (medium) The web of the previous version crashes on the tournée list and the route page once a vehicle route exists

- **Rerun:** `part-d.sh` step 6 (`e2e/test-36/old-web-vehicle-route.ts`);
  `artifacts/test-36/part-d/old-web-vehicle-route.txt`, `old-web-tournees.png`,
  `old-web-tournee-vehicule.png`.
- **Path:** web at `93afa56` with the phase 36 API. Through the API, a truck and a route with
  `vehicleId` (so `sellerId` null) and two stops. Open `/tournees`, then `/tournees/<route>`.
- **Expected:** the version still running keeps working during the deploy (runbook line 114,
  migration header "the version still running keeps working").
- **Actual:** both pages show "This page couldn't load": `Cannot read properties of null (reading
  'fullName')` (old `components/tournees/routes-list.tsx:97`, `r.seller.fullName`) and
  `(reading 'id')` (old `route-editor.tsx:102`, `route.seller.id`). The other screens tried
  (aujourd'hui, rapports, commandes, livraisons, dépôts) load.
- **Why medium:** it lasts as long as an old web is served or an old tab stays open: from the
  API deploy until the web deploy and a reload. One "Convertir" (bulk) turns every seller route
  into a vehicle route at once, so the whole tournée screen of that company goes down for those
  users. No data is touched.
- **Fix proposal:** nothing to change in the code now that both are deployed. In the runbook:
  deploy the web with the API, and convert seller routes only once both are live. Lock with
  `old-web-vehicle-route.ts` for the next DTO change that makes a field nullable.

#### D-4 (low) The backfill's "else the order's truck" never applies to pre-36 rows

- **Rerun:** `part-d.sh`, row `visit_order_on_his_truck` of `backfill.md` and the info rule
  `info_visits_left_null_although_their_order_names_a_truck` of `backfill-truth.txt` (1 row).
- **Path:** the prévendeur seller2 drives T2, takes an order on T2 with a visit; the order is
  delivered from T2. After the migration and the backfill.
- **Expected (spec):** "`Visit.vehicleId` from the linked sale's `warehouseId` when it is a truck,
  else from the order's".
- **Actual:** the visit stays null. The fallback reads `orders."vehicleId"`
  (`apps/api/src/stock/vehicle-backfill.service.ts:58`), a column phase 36 added, null on every
  pre-36 order, and the backfill does not fill it. On pre-36 data the branch is dead: every visit
  linked to an order stays "Véhicule inconnu", even when the order's dépôt and its BL are the truck.
- **Why low:** nothing wrong is written; the rule "never guess" holds. Fewer rows are known than
  could be.
- **Fix proposal:** the owner decides whether an order's dépôt that is a truck is a fact about
  the visit (the prévendeur's own truck). If yes, the fallback reads the order's `warehouseId`
  when it is a truck; if no, drop "else the order's" from the spec and the runbook so nobody
  expects it. Lock with the row above.

### 12.5 Production and the owner

- Nothing in part D was sent to production; the Neon block was **not** run by this pass.
- In part B the anonymous `GET /vehicle-types` on production answered 401, so the phase 36 API is
  deployed there.
- **Owner note (2026-11-15): Neon is confirmed migrated.** Migration
  `20261114232622_vehicle_first_distribution` was applied on 2026-11-15 at 07:43 UTC, **before**
  the merge. That is the safe order (migrate first, deploy after), so the 500s of D-1 did not
  happen in production. D-1 and D-2 stay as findings about what the runbook tells the next
  person to do.
- The owner's note is about the migration. Whether `db:backfill-vehicles` ran twice on Neon was
  not stated; to check, in the Neon SQL editor:
  `SELECT reason, count(*) FROM vehicle_assignments GROUP BY 1;` (the `backfill` rows come from
  the migration itself) and
  `SELECT count(*) FROM visits v JOIN sales s ON s.id = v."saleId" JOIN warehouses w ON w.id = s."warehouseId" WHERE w.type = 'VEHICLE' AND v."vehicleId" IS NULL;`
  (0 once the backfill has run).

### 12.6 Part D: what was not tested, and why

- **A copy of production:** not available and not to be touched. The pre-36 history was made by the
  pre-36 code through its API, so its rows have the shapes production has.
- **Lock time at Neon scale and over the network:** measured locally on 50 000 rows; Neon's
  storage and the real row counts are not known here.
- **A sale or a visit written by the old API while the backfill runs:** the backfill only fills
  null columns in one transaction per company; not raced.
- **The old web on a phone** (mobile projects) and the old screens not listed in 12.2: only the
  desktop suite and seven tournée / order / dépôt screens were run.
- **The worktree `../erp-main`** is left at `93afa56` with `apps/api/.env` and an
  `e2e/node_modules` link (both git-ignored), so part D reruns with one command.

## 13. Part E: web and phone

**Suite:** `e2e/web/vehicles.spec.ts` with `vehicles-data.ts` (the data) and
`vehicles.playwright.config.ts`; `pnpm test:vehicles:web` (section 2), about 5 minutes. Real
chromium against the built web (`:3005`) and API (`:3003`, database `erp_t36`, connected as
`erp_app`). Five projects: **360 px `ar`, 360 px `fr`, 393 px `ar`, 393 px `fr`, 1280 px `fr`**.
Proofs: `artifacts/test-36/web/` (319 files: a screenshot of every state per project,
`<project>-bidi.json`, `<project>-bidi-code-arabe.json`, `<project>-code-long.json`,
`wilayas-59-69-{fr,ar}.txt`, `run.txt`, `results.json`).

Each project makes **its own company** through the API, every user invited with
`POST /users/invite`: an owner, four sellers (one with an Arabic name), a livreur; "Dépôt Batna";
six types (one archived, one unused); eight trucks: `VAN-28 MXT 01` (plate `00123-119-28`),
`VAN34-SELF/MT`, `LIV 28 MIX`, **`VAN شاحنة 01`** and **`VAN 01 شاحنة`** (a code with an Arabic
word, typed in the two possible orders), two 30-character codes that differ only by their last
number, and one truck with no code and no type; two vehicle routes, three old seller routes; two
confirmed orders. A second, bare company gives the empty states. Nothing is written with SQL.
Map tiles are answered locally. A failing `expect.soft` is a finding; the rest must pass.

### 13.1 Results

| Test (each on the 5 projects) | Pass | Fail | Finding |
|---|---|---|---|
| Empty company: types, vehicles, tournées, the new-route sheet with no truck | 5 | 0 | |
| Types de véhicules: list, form, duplicate code, archive refused, archive accepted | 5 | 0 | |
| Véhicules: cards and the four filters | 5 | 0 | |
| Véhicules: form, "Proposer un code", archived type kept out, code taken | 5 | 0 | |
| Driver sheet with the "already has a truck" confirm; history sheet of both trucks | 5 | 0 | |
| Utilisateurs: "Véhicules conduits", the link to the truck, the empty case | 5 | 0 | |
| Tournées: grouped by vehicle, "Véhicule" first, "pour un vendeur", "Convertir", bulk banner | 5 | 0 | |
| Aujourd'hui: truck header; seller without truck; seller with nothing; Arabic-code truck | 5 | 0 | |
| Commandes: filter by delivery truck, assign one; the livreur's "Mes livraisons" | 5 | 0 | |
| Bidi: the three Latin codes, the plate, a type code and a dépôt code on five screens | 1 | 4 | E-3 (the four phone projects) |
| Bidi: a code with an Arabic word | 0 | 5 | E-1 |
| Long codes on the card | 0 | 5 | E-2 |
| Wilayas: 69 unique numbers, 1–58 against the official list, 59–69 written down | 5 | 0 | |
| English: no raw key on ten screens and sheets | 5 | 0 | |
| Dépôts: the list still shows the trucks with their code | 5 | 0 | |
| **Total: 75 runs** | **61** | **14** | **3 findings** |

After part E, on Node 22: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (API 70 suites / 930
tests, shared 573, web 59), and `git diff --stat origin/main -- apps packages` is empty.

In every test, on every screen and open sheet: no horizontal overflow (`overflowProblems` of the
phone suite: page width, and boxes that hide content to the side), no raw message key, no
uncaught page error, no API answer of 500 or more. **None was seen in 75 runs.**

### 13.2 What the prompt asked to be said in words

- **Types de véhicules.** The list shows the owner's code, the name, the activity, the number of
  trucks and the prefix; the archived type is gone. The empty state names `MXT`, `SELF/MT` and
  `MIX` as examples of the owner's own codes. A second `mxt` is refused with a sentence. Archiving
  `MXT` while three trucks use it shows "Des véhicules utilisent encore ce type. Changez d'abord
  leur type." (and its Arabic) and the type stays; archiving an unused type works.
- **Véhicules.** On a card the code is the biggest text (20 px, the name under it 14 px), then the
  type badge with its activity, `28 · M'Sila` / `28 · المسيلة`, the plate and the capacity, the
  dépôt, "Chauffeur du jour" with "Changer". Search finds a code, a name or a plate; the type
  filter does not offer the archived type; the wilaya filter lists only wilayas that have a truck
  (05, 28, 34); the dépôt filter gives the three trucks of Batna.
- **"Proposer un code".** Nothing chosen: `01`. MXT + 28 with `VAN-28 MXT 01` taken:
  `VAN-28 MXT 02`. SELF/MT (no prefix) + 34: `34 SELF/MT 01`. The archived type is not offered,
  and at creation a driver who already has a truck is not in the list. `van-28 mxt 01` is
  refused with "Ce code est déjà utilisé." and the sheet keeps what was typed.
- **Driver sheet.** "Enregistrer" is off until the driver changes. Choosing a driver who has
  another truck shows, before anything is written, "سمير بن يوسف conduit déjà ⁦VAN34-SELF/MT⁩ ·
  Camion Bordj. Ce véhicule restera sans chauffeur." and the button becomes "Déplacer le
  chauffeur". After it: the card names him, the truck he left says "Sans chauffeur", the history
  of the first shows him on top with the reason and who decided, the history of the second closes
  on "Sans chauffeur".
- **"Véhicules conduits".** The user's menu opens his periods, newest first: the truck he drives
  with "En cours", the one he left with its two dates and its type; each row links to
  `/stock/vehicules?vehicle=…`, where that truck comes first. A worker who never drove gets a
  sentence.
- **Tournées.** The list is one card per truck, sorted by code, with today's driver and "Qui
  conduit aujourd'hui ?"; the old seller routes follow under "Tournées par vendeur". The banner
  says "2 tournées sont encore planifiées pour un vendeur" (`جولتان ما زالتا مخططتين لبائع`):
  the two whose seller drives a truck, not the third. The new-route sheet opens on "Véhicule"
  (code · type · driver) with no seller field; the link "Tournée pour un vendeur (sans véhicule)"
  swaps the field and back. "Convertir" moves one route under its truck and the banner goes to 1;
  "Tout convertir" asks "Convertir 1 tournée ?", answers "1 tournée convertie", and the banner
  leaves. The seller with no truck keeps his route and has no "Convertir".
- **Aujourd'hui.** The driver of `VAN-28 MXT 01` sees `VAN-28 MXT 01 · M'Sila`
  (`VAN-28 MXT 01 · المسيلة`, the code at the right in Arabic) above the stops of his truck's
  tournées. A seller with no truck has no header and his seller route as before. A seller with
  neither sees the message that existed before phase 36 ("Pas de tournée aujourd'hui…").
- **Orders and delivery.** `/commandes` has a "Véhicule de livraison" filter that offers the
  delivery and mixed trucks only; choosing one leaves that truck's orders. On an order,
  choosing a truck saves at once ("Véhicule de livraison enregistré"), shows the truck with its
  driver of the day, and switches the livreur field off. The livreur who drives that truck finds
  both orders in "Mes livraisons".
- **Bidi.** Each code is measured where it is drawn: the position of every part (`VAN-28`,
  `MXT`, `01`) read from the glyphs, 15 places per project over five screens, plus the sheets.
  `VAN-28 MXT 01`, `VAN34-SELF/MT`, `LIV 28 MIX`, `SELF/MT`, `CDD BATNA 05` and the plate
  `00123-119-28` are always drawn left to right in the order typed, always isolated from the text
  around them (`<bdi dir="ltr">`, or U+2066…U+2069 inside `<option>` and inside sentences), in
  lists, headers, the warning sentence, the history title and the closed selects. The Arabic
  screenshots were read one by one and agree. A code with an Arabic word does not hold: E-1.
  **Toasts** never name a truck (they are fixed sentences). **PDF / print:** no template under
  `apps/api/src/printing` or `documents` reads a truck, a dépôt code or a plate, so no printed
  document shows one; nothing to check there.
- **Wilayas.** The form lists 69 options, numbers 1 to 69, each once, no name twice. Names 1 to
  58 match the official list (law 84-09 for 1–48, law 19-12 for 49–58) in French and in Arabic,
  compared without accents and case. **59 to 69, to confirm by the owner** (not marked right or
  wrong here):

  | N° | French | Arabic |
  |---|---|---|
  | 59 | Aflou | أفلو |
  | 60 | Barika | بريكة |
  | 61 | El Kantara | القنطرة |
  | 62 | Bir El Ater | بئر العاتر |
  | 63 | El Aricha | العريشة |
  | 64 | Ksar Chellala | قصر الشلالة |
  | 65 | Aïn Oussera | عين وسارة |
  | 66 | Messaad | مسعد |
  | 67 | Ksar El Boukhari | قصر البخاري |
  | 68 | Bou Saâda | بوسعادة |
  | 69 | El Abiodh Sidi Cheikh | الأبيض سيدي الشيخ |

  The source the code cites (`packages/shared/src/wilayas.ts:5-8`) is **not** the press: "law
  26-06 of 4 April 2026 (JO n° 25), names by presidential decree 26-206 (JO n° 40), numbers as
  published with the vehicle registration arrêté of 17 June 2026 (JO n° 50 of 15 July 2026)",
  and it adds that an earlier press list of November 2025 numbered 60–69 differently. The prompt
  says PR #72 took them from press reports. This pass could not read the Journal officiel: the
  owner should check the eleven lines against JO n° 40 and n° 50, the numbers above all, because
  `wilayaCode` is what is stored.
- **Sheets.** In every sheet Tab stays inside (25 presses), Escape closes, fields and buttons are
  at least 44 px tall with a 16 px font on the phone, and the main action stays on screen while
  the form scrolls (the footer is sticky).
- **English.** Ten screens and sheets served in `en`: no raw key.

### 13.3 What holds up well

- At 360 px in Arabic every phase 36 screen is usable end to end: the owner creates a type and a
  truck, changes a driver, converts the routes; the driver opens his day; the office assigns a
  delivery truck. Nothing scrolls sideways and nothing is reachable only on a wide screen.
- The driver move is safe to tap: the consequence is written on the sheet before the write, and
  the button changes its name.
- The lists tell the truth after each write without a reload (driver on the card, route under
  its truck, banner count), and what the screen shows was checked against the API for the
  delivery truck.
- The owner's own codes are isolated everywhere, including inside `<option>` text, which is
  where test 30 had found scrambled amounts.

### 13.4 Findings

Part E: **0 critical, 0 high, 2 medium, 1 low.** Rerun: `pnpm test:vehicles:web` (add
`--project m360-ar` for one screen; the file must run whole, its tests build on each other).

#### E-1 (medium) A code with an Arabic word is not drawn in the order typed, and two different codes are drawn the same

- **Rerun:** the test "bidi: a code with an Arabic word…" (fails on the 5 projects);
  `artifacts/test-36/web/<project>-bidi-code-arabe.json`, `…-bidi-code-arabe-carte-1.png` and
  `-carte-2.png`, `…-bidi-code-arabe-formulaire.png`, `…-tournee-nouvelle-code-arabe-choisi.png`.
- **Path:** two trucks, codes `VAN شاحنة 01` (typed VAN, the word, 01) and `VAN 01 شاحنة`
  (typed VAN, 01, the word). The API accepts both: they are different texts. Open
  `/stock/vehicules`.
- **Expected:** the prompt: a code with an Arabic word keeps its order; and two trucks never show
  the same code (the reason codes are unique).
- **Actual:** both cards read **`VAN 01 شاحنة`**, glyph for glyph (left to right: `VAN`, `01`,
  the word). The same in the tournée select, the history title, "Véhicules conduits", the header
  of "aujourd'hui" and the form field itself, so the owner cannot see the difference while
  typing either. A driver told "take VAN شاحنة 01" finds two.
- **Cause:** `components/vehicles/vehicle-code.tsx:9` (`<bdi dir="ltr">`) and `isolateLtr`
  (line 17) isolate the code from the sentence around it, which works, but inside the code the
  browser's bidi rules still apply: digits that follow Arabic letters join the Arabic run and are
  drawn before it. `#vehicle-code` has `dir="ltr"` (`vehicles-page.tsx:522`), same effect.
- **Why medium:** same harm as B-5 (two trucks that look alike), reached by ordinary typing in
  the app's default language. No figure is wrong.
- **Fix proposal:** with B-5, in PR 8. Either refuse a code that mixes Arabic letters with
  Latin letters or digits after them (simplest, said in the hint under the field), or draw a
  code part by part (each space-separated part in its own `<bdi>`), and compare codes for
  uniqueness in their drawn form. Lock with this test.

#### E-2 (medium) A long code is cut on the vehicle card at every width, with no way to read it in full

- **Rerun:** the test "long codes: two 30-character codes…" (fails on the 5 projects);
  `<project>-code-long.json`, `…-code-long-carte-1.png`, `-carte-2.png`, `…-code-long-cartes.png`.
- **Path:** two trucks, `VAN-28 GROS DETAIL MSILA N 001` and `…N 002` (30 characters, the length
  the API and the form allow). Open `/stock/vehicules`.
- **Expected:** the code is the truck's identity and "big" on the card (spec); docs/ui.md rule 8:
  a truncated text can be read in full by a tap.
- **Actual:** the code needs 336 px and gets 206 px at 360, 239 px at 393 and **203 px at 1280**
  (three columns). In French both cards read `VAN-28 GROS DET…`: the number that tells them
  apart is hidden. In Arabic the cut falls on the start (`…ETAIL MSILA N 001`). The code element
  has no `title` and no tap shows it; the name under it has one. The owner must open the form of
  each truck to know which is which. At that size (336 px for 30 characters) a code is cut from about 18 characters at 360 px.
- **Cause:** `components/vehicles/vehicles-page.tsx:311` (`truncate text-xl` on the code) next to
  two 44 px buttons; `VehicleCode` is `whitespace-nowrap` (`vehicle-code.tsx:9`).
- **Fix proposal:** PR 11. Let the code wrap on its spaces on the card (or step the font down
  when it is long) and put the full code in `title`. Lock with this test.

#### E-3 (low) On a phone the order list cuts the delivery truck off its row

- **Rerun:** the test "bidi: VAN-28 MXT 01…" (fails on the four phone projects on
  `/commandes: "LIV 28 MIX" … is cut by the line that holds it`); `<project>-bidi.json`,
  `m360-ar-commandes-filtre-vehicule.png`.
- **Path:** an order on `LIV 28 MIX`, whose driver is a livreur. `/commandes` at 360 or 393 px.
- **Expected:** the order card shows its delivery truck ("filter and assign by delivery truck").
- **Actual:** the second line of the card is `BC-2026-000001 · Yacine Livreur · LIV 28 MIX` on
  one truncated line: the truck, last, is what gets cut (`BC-2026-000001 · Yacine Livr…`). At
  1280 px it shows. After filtering by a truck, no row on the phone names it.
- **Cause:** `components/tournees/orders-list.tsx:224-241`: number, date, livreur and truck in
  one `truncate` paragraph.
- **Fix proposal:** PR 11: the truck on its own line (or before the livreur's name) below `md`.

### 13.5 Notes (seen, not counted as findings)

- `vehicles.todayNoVehicle` ("Vous ne conduisez aucun véhicule aujourd'hui.") and
  `vehicles.unknown` ("Véhicule inconnu") are translated in the three files and used by no
  component. A seller without a truck gets the pre-36 screen, which is what the prompt asks;
  phase 37 will need "Véhicule inconnu" for the null rows of the backfill.
- The clôture screen names the truck by its name only, not its code
  (`components/tournees/closing-screen.tsx:190`).
- The app writes `M'Sila` (the official spelling); the prompt's example writes `M'sila`.
- A driver sees, on "aujourd'hui", the stops of his truck's tournées **and** of his own old
  seller routes together until they are converted. That is the spec ("old seller routes still
  work"); converting removes the double list.
- On the dépôts list a truck's line (`code · name`) truncates on a phone; the code comes first
  and stays whole with the codes tried.
- A long Latin truck name is cut at its start in Arabic (`…ne nord de la wilaya de M'sila`);
  the full name is in `title`.
- The opened list of a native `<select>` belongs to the browser and cannot be photographed; the
  option texts were read from the DOM and the closed select was photographed with a truck chosen.

### 13.6 Part E: what was not tested, and why

- **Real phones and other browsers** (Safari on iOS, Chrome on Android, the on-screen keyboard
  over a sheet): chromium's phone emulation only. Bidi is the same algorithm everywhere, fonts
  are not.
- **Screen readers**, colour contrast and **Lighthouse** (Performance is listed by PR #72 as
  left out; known, not a finding). **Dark mode.**
- **The per-vehicle report screen:** left out by PR #72 (known, not a finding); `?by=vehicle`
  was tested through the API in part B.
- **The manager, supervisor and storekeeper in the browser:** their reach was tested through the
  API with SQL truth queries (part B, with B-1, B-2, B-3, B-6). Part E ran as the owner, three
  sellers and a livreur.
- **The Essentiel company in the browser:** the gate was tested through the API (part B).
- **A delivery done in the browser** and the truck form of the dépôts screen: only their lists
  were opened. The delivery and its stock are part A (A-2).
- **English at full depth:** raw keys only, on ten screens and sheets; the flows ran in `ar` and `fr`.
- **Stale data on a second device** after a driver change (a seller's phone left open): not tried.
