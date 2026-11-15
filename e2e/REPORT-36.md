# Test report — phase 36, distribution par véhicule

**Target:** `c06adf0` (`origin/main`; phase 36 is PR #72: `0751faa` API, `7370022` web, `48dbd35` e2e, `284e8e5` docs; migration `20261114232622_vehicle_first_distribution`).
**Branch:** `test/phase-36-vehicle-first`. **Date:** 2026-11-15.
**Prompt:** [`docs/prompts/test-36-vehicle-first.md`](../docs/prompts/test-36-vehicle-first.md). **Spec:** [`phase-36-vehicle-first-distribution.md`](../docs/prompts/phase-36-vehicle-first-distribution.md).
**Rule of the pass:** find and prove, do not fix. Nothing under `apps/` or `packages/` is changed.

**This report covers the baseline, the seed, part A and part B** (part B is section 10). Parts C to
E are not done (section 7). The verdict at the end is therefore provisional.

## Status (read this first when resuming)

| Part | State | Where |
|---|---|---|
| 0. Baseline and seed | done | `e2e/test-36/baseline.sh`, `e2e/api/vehicles-seed.ts` |
| A. API correctness | done: 109 lines (90 pass, 12 fail on 8 findings, 7 notes) | `e2e/api/vehicles.ts`, `e2e/sql/vehicles-history.sql` |
| B. Scope, isolation and security | done: 117 lines (101 pass, 7 fail on 5 findings, 9 notes) + 1 low from notes | `e2e/api/vehicles-scope.ts`, section 10 |
| C. Concurrency | not done | |
| D. Backfill and upgrade | not done (the seed already writes its history and the expected trucks) | |
| E. Web and phone | not done | |
| Final go / no-go, fix plan | provisional, on parts A and B | sections 8 and 9 |

Findings of part A: **1 critical, 1 high, 3 medium, 3 low.** A-2 is critical by the owner's
decision of 2026-11-15: every truck, delivery trucks included, is loaded by chargement each day
and unloaded back to the dépôt, so a delivery BL must take its stock from the truck.

Findings of part B: **0 critical, 2 high, 3 medium, 1 low** (section 10.4).

To resume: start the stack (section 2), run `pnpm test:vehicles:seed` again if
`e2e/.auth/vehicles-fixture.json` is gone or older than 12 h (it makes new companies), go on
with part C. Part B makes its own companies on each run and needs no seed. The data stays in
the local database `erp_t36`.

## 1. What was tested

| Part | Suite | What it covers |
|---|---|---|
| 0 | `e2e/test-36/baseline.sh` | lint, typecheck, build, test on Node 22 with the Jest integration suites on a scratch database, then the three Playwright projects. |
| 0 | `e2e/api/vehicles-seed.ts` | Three companies through the real API, every user invited with `POST /users/invite` and accepting his invitation. A (Distribution): owner, manager, supervisor with two sellers, a seller outside the team, two livreurs, a storekeeper; dépôt principal + "Dépôt Batna" (`CDD BATNA 05`); five trucks over the two dépôts (`VAN-28 MXT 01` CASH_VAN, `PRV05-DD01` PRESALE, `LIV 28 MIX` DELIVERY, `VAN34-SELF/MT` MIXED, one without type or code); five types (three with `codePrefix`, one without, `HRC` archived). B: the same type codes and truck codes. E: Essentiel. Plus the history part D needs, with the truck the backfill must find for each row (`history` in the fixture): two old seller routes, a vehicle route, two visits linked to van sales, an order whose BL left a truck, an order put on a truck whose BL left the dépôt, an order delivered from the dépôt principal, two visits with neither. |
| A | `e2e/api/vehicles.ts` | Nine areas, each in its own new company: vehicle types; truck identity (API and CHECK constraints written as the app role); driver change (every path, forced rollback, sessions); `driverAt` / `vehicleAt` called on the compiled service, the worker history and both paginations; append-only as both database roles; tournées per vehicle, convert one and bulk; the truck frozen on visits and orders, the order that follows its delivery truck; stock and cash after a driver change; livreurs and activities. |
| A | `e2e/sql/vehicles-history.sql` | 17 rules read with SQL over the whole database after the scenario (driver = last history row, one truck per driver, frozen trucks, truck stock = its movements…), then the repo's own `reconcile` CLI. |

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

- `deliveryVehicleId` of a pre-36 order delivered by a truck but booked on the dépôt will stay
  null after the backfill, while the same flow today stores the truck (see A-2). The seed holds
  one such row (`order_on_truck_bl_from_depot`); part D has to run the backfill to prove it.

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

- **Parts C, D and E** were not asked in these sessions: every race, the backfill and the
  migration lock time, every screen and the bidi screenshots, the wilaya names. The seed already
  holds what they need (company B with A's codes, the Essentiel company, the manager and
  supervisor limited to "Dépôt Batna", the history with its expected trucks). Part B's own gaps
  are in 10.7.
- **Production:** only the three anonymous `GET`s of the ground rules were sent, in part B (all
  401). Nothing else.
- **`driverAt` / `vehicleAt` through HTTP:** they have no route. They were called on the compiled
  `VehiclesService` (`apps/api/dist`) with a Prisma client on the scratch database.
- **Idempotency-Key replays** of the driver change and of convert: done in part B (finding B-4).
- **Known, left out by PR #72** (not findings): the per-vehicle report screen, Lighthouse
  Performance.

## 8. Go / no-go for phase 37 (provisional, parts A and B)

**No-go until A-2 is fixed. After that, no-go yet for two columns; go for the rest.**

- **A-2 is critical.** With delivery trucks loaded every day, the stock of each delivery truck
  and of the dépôt principal is wrong after the first delivery. Phase 37's fill rate and
  per-truck sales read exactly those figures. It must be fixed before any per-truck statistic.
- `vehicle_assignments`, `Route.vehicleId` and `Order.vehicleId` behaved as specified in every
  path tried. Phase 37 can read them.
- `Visit.vehicleId` can disagree with the dépôt its sale left (A-1), and a truck can be "driven"
  by someone who left (A-3). A statistic per vehicle built today would be wrong for those rows.
- **Isolation holds** (part B): no row of another company is readable or writable through any
  new route, filter or body field, and the Essentiel gate holds. Inside a company, a manager
  limited to one dépôt can write onto trucks and routes of another dépôt (B-1, B-2). That does
  not corrupt a figure, but it moves a tournée or a driver behind the back of the dépôt that
  owns it. Fix it before phase 37 adds per-dépôt vehicle screens.
- Parts C to E are not done. The backfill (D) decides whether history before phase 36 can be
  trusted at all.

## 9. Fix plan (small PRs, in order; none is opened)

| # | PR | Findings | Test that locks it |
|---|---|---|---|
| 1 | A delivery BL leaves the delivery truck (`deliveryVehicleId` wins over `order.warehouseId`); the rule written in `docs/domain.md` | A-2 | The A7 check "the BL of an order put on a loaded delivery truck leaves that truck", plus load 100 / deliver 6 / unload as an integration test. |
| 2 | Every way a driver stops driving goes through `assignDriver`: truck switched off, user deactivated, role that cannot drive | A-1, A-3 | The two A3 checks and the A8 check, plus the SQL rules `driver_is_a_live_user_who_may_drive` and `visit_sale_left_the_truck_frozen_on_the_visit` as an integration test. |
| 3 | One truck reach for every planner write: the freed truck of a driver move and the target truck of a convert are checked with `assertPlanned` before anything is written | B-1, B-2 | The three B2 checks "the Batna manager puts seller1…", "…converts seller1's old route", "…bulk-converts". |
| 4 | The driver-change guard looks at the cash since the last clôture, not at one session row | A-4 | The A8 check "cash responsibility after the move". |
| 5 | Truck history read by planners and the driver only; `@Idempotent()` on the driver change and convert | B-3, B-4 | The B2 check "truck history…" and the B6 check "replayed … after a later change". |
| 6 | Codes and plates: refuse C0 controls, bidi controls and zero-width characters; codes compared as text (`lower(code) =`), search escaped | B-5, A-5, A-7 | The two B5 checks, the two "compared as text" checks and the search check. |
| 7 | `VEHICLE_FIELDS_ON_DEPOT` at creation; code helper past 99; one reach rule for a supervisor's team trucks | A-6, A-8, B-6 | The two A2 checks and the B2 INFO line on VAN turned into an assertion. |

PR 1, PR 2 and PR 3 come before phase 37 starts; 4 to 7 can go alongside it.

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
| B6 idempotency and audit (`idempotency`) | 8 | 4 | 1 | 3 | B-4 |
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

Part B: **0 critical, 2 high, 3 medium, 1 low.**

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

#### B-4 (medium) A driver change replayed after a later change puts the old driver back

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
