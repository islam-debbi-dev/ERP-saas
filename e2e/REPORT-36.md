# Test report — phase 36, distribution par véhicule

**Target:** `c06adf0` (`origin/main`; phase 36 is PR #72: `0751faa` API, `7370022` web, `48dbd35` e2e, `284e8e5` docs; migration `20261114232622_vehicle_first_distribution`).
**Branch:** `test/phase-36-vehicle-first`. **Date:** 2026-11-15.
**Prompt:** [`docs/prompts/test-36-vehicle-first.md`](../docs/prompts/test-36-vehicle-first.md). **Spec:** [`phase-36-vehicle-first-distribution.md`](../docs/prompts/phase-36-vehicle-first-distribution.md).
**Rule of the pass:** find and prove, do not fix. Nothing under `apps/` or `packages/` is changed.

**This report covers the baseline, the seed and part A only**, as asked. Parts B to E are not done
(section 7). The verdict at the end is therefore provisional.

## Status (read this first when resuming)

| Part | State | Where |
|---|---|---|
| 0. Baseline and seed | done | `e2e/test-36/baseline.sh`, `e2e/api/vehicles-seed.ts` |
| A. API correctness | done: 109 lines (90 pass, 12 fail on 8 findings, 7 notes) | `e2e/api/vehicles.ts`, `e2e/sql/vehicles-history.sql` |
| B. Scope, isolation and security | not done | |
| C. Concurrency | not done | |
| D. Backfill and upgrade | not done (the seed already writes its history and the expected trucks) | |
| E. Web and phone | not done | |
| Final go / no-go, fix plan | provisional, on part A alone | sections 8 and 9 |

Findings of part A: **0 critical, 2 high, 3 medium, 3 low.** A-2 becomes critical if delivery
trucks are loaded by chargement: that is the owner's call (see the finding).

To resume: start the stack (section 2), run `pnpm test:vehicles:seed` again if
`e2e/.auth/vehicles-fixture.json` is gone or older than 12 h (it makes new companies), go on
with part B. The data stays in the local database `erp_t36`.

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
| Notes (INFO lines, neither pass nor fail) | 7 | | | section 5.4 |
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

### 5.1 High

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

#### A-2 (high; critical if delivery trucks are loaded) The BL of an order put on a delivery truck leaves the dépôt principal, not the truck

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
- **Owner's decision needed:** is a delivery truck loaded by chargement before it leaves? If yes
  this is a wrong stock figure per dépôt (critical by the rule of this pass). If deliveries are
  meant to leave the dépôt's stock directly, the stock is right and only the rule needs writing
  down in `docs/domain.md`. Livreurs could not drive a truck before phase 36, so no company has
  met this yet.
- **Fix proposal (if loaded):** when an order is on a delivery truck, the BL leaves that truck
  (and the availability shown on the order reads it). Lock with the check above.

### 5.2 Medium

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

### 5.3 Low

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

### 5.4 Notes (seen, not counted as findings)

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

### 5.5 Suspected, not proven

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

- **Parts B, C, D and E** were not asked in this session. In particular: tenant isolation and
  scope of the new routes, the feature gate on the Essentiel company, hostile input, every race,
  the backfill and the migration lock time, every screen and the bidi screenshots, the wilaya
  names. The seed already holds what they need (company B with A's codes, the Essentiel
  company, the manager and supervisor limited to "Dépôt Batna", the history with its expected
  trucks).
- **Production:** no request of any kind was sent to the Vercel URLs. The three anonymous `GET`
  checks of the ground rules belong with part B.
- **`driverAt` / `vehicleAt` through HTTP:** they have no route. They were called on the compiled
  `VehiclesService` (`apps/api/dist`) with a Prisma client on the scratch database.
- **Idempotency-Key replays** of the driver change and of convert: part B. Here "the same change
  again writes no row" was checked without a key.
- **Known, left out by PR #72** (not findings): the per-vehicle report screen, Lighthouse
  Performance.

## 8. Go / no-go for phase 37 (provisional, part A only)

**No-go yet, for two columns; go for the rest.**

- `vehicle_assignments`, `Route.vehicleId` and `Order.vehicleId` behaved as specified in every
  path tried. Phase 37 can read them.
- `Visit.vehicleId` can disagree with the dépôt its sale left (A-1), and a truck can be "driven"
  by someone who left (A-3). A statistic per vehicle built today would be wrong for those rows.
- `Order.deliveryVehicleId` and the stock of a delivery truck need the owner's answer to A-2
  first: phase 37's fill rate and per-truck sales read exactly those.
- Parts B to E are not done. The backfill (D) decides whether history before phase 36 can be
  trusted at all, and isolation (B) is untested on every new route.

## 9. Fix plan (small PRs, in order; none is opened)

| # | PR | Findings | Test that locks it |
|---|---|---|---|
| 1 | Every way a driver stops driving goes through `assignDriver`: truck switched off, user deactivated, role that cannot drive | A-1, A-3 | The two A3 checks and the A8 check, plus the SQL rules `driver_is_a_live_user_who_may_drive` and `visit_sale_left_the_truck_frozen_on_the_visit` as an integration test. |
| 2 | Decide and write the rule for a delivery truck's stock; if loaded, the BL leaves the truck | A-2 | The A7 check "the BL of an order put on a loaded delivery truck leaves that truck". |
| 3 | The driver-change guard looks at the cash since the last clôture, not at one session row | A-4 | The A8 check "cash responsibility after the move". |
| 4 | Codes compared as text (`lower(code) =`), search escaped | A-5, A-7 | The two "compared as text" checks and the search check. |
| 5 | `VEHICLE_FIELDS_ON_DEPOT` at creation; code helper past 99 | A-6, A-8 | The two A2 checks. |

PR 1 and the decision of PR 2 come before phase 37 starts; 3 to 5 can go alongside it.
