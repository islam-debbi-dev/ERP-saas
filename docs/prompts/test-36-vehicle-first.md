You are a senior QA engineer testing **phase 36 (distribution par véhicule: vehicle types, truck identity, driver history, tournées per vehicle, the truck frozen on visits and orders)** of the ERP SaaS in this repo. Your job is to **find and prove** problems, not to fix them. Be skeptical: phase 37 will build every statistic on these columns, and a truck stock or a driver history that is wrong once is wrong in every report after it.

## Task: Test 36 — vehicle-first distribution

Branch: `test/phase-36-vehicle-first`. Phase 36 is merged (PR #72: `0751faa` API, `7370022` web, `48dbd35` e2e, `284e8e5` docs; migration `20261114232622_vehicle_first_distribution`). The spec is [`phase-36-vehicle-first-distribution.md`](phase-36-vehicle-first-distribution.md): every rule in it is something to check. It stands on phases 14 (sales force, scope), 15 (dépôts, truck = dépôt), 16 (tournées, visits, orders, seller sessions), 24 (dépôt access) and the audit-02 batch 1 fix A-1 (a seller who drives a truck sells from it, PR #69).

### Read first (do not skip)
- `AGENTS.md` (§3, §5), `docs/ui.md` (phone checks), `docs/domain.md` (Stock, Tournées, the new vehicle rules), the spec above, `e2e/README.md`, the PR #72 description (its Decisions and Not done).
- API: `apps/api/src/stock/vehicles.service.ts` (`assignDriver`, `currentVehicleOf`, `vehicleAt`, `driverAt`, `vehiclesOf`), `vehicle-types.service.ts`, `vehicles.controllers.ts`, `warehouses.service.ts`, `warehouses.controllers.ts`, `vehicle-backfill.service.ts` + `.cli.ts`; `apps/api/src/tournees/routes.service.ts`, `visits.service.ts`, `orders.service.ts`, `seller-sessions.service.ts`, `tournee-scope.ts`, `tournee-reports.service.ts`, `tournees.controllers.ts`; `apps/api/src/sales/sales.service.ts` (the truck a sale takes, A-1); `apps/api/src/prisma/tenant-extension.ts`; the migration above.
- Shared: `packages/shared/src/vehicles.ts` (code helper), `wilayas.ts`, `schemas/vehicles.ts`, `schemas/warehouses.ts`, `schemas/tournees.ts`, `errors.ts`.
- Web: `apps/web/src/components/vehicles/*`, `components/stock/warehouses-manager.tsx`, `components/tournees/{routes-list,route-editor,today-screen,orders-list,order-view}.tsx`, `components/users/users-page.tsx`, `lib/vehicles.ts`, `lib/tournees.ts`, the pages `stock/vehicules` and `parametres/types-vehicules`.
- Existing tests, so you do not repeat them: `apps/api/test/vehicles.int-spec.ts`, `packages/shared/src/{vehicles,wilayas}.test.ts`, `schemas/vehicles.test.ts`, the phase 36 steps in `e2e/web/web.spec.ts` and `mobile.spec.ts`, and the audit-02 suites under `e2e/api/security/` (reuse their helpers in `e2e/lib/http.ts`).
- Use the `/graphify` skill to find any other file instead of grepping the whole repo.

### Ground rules
- **Never touch production.** Against the public Vercel URLs you may only send anonymous `GET` requests (check that `/vehicle-types`, `/warehouses/:id/assignments` and `/users/:id/vehicle-assignments` answer 401 without a token, nothing more). Everything else runs locally on databases you created (`docker compose -f infra/docker-compose.yml up -d db db_test`, `pnpm db:migrate`, `pnpm db:seed`). Use a scratch database of your own for the backfill and upgrade checks, never the dev database `erp`.
- **Do not edit `apps/` or `packages/`.** New scripts, specs and SQL go under `e2e/` (e.g. `e2e/api/vehicles.ts`, `e2e/sql/vehicles-*.sql`, `e2e/web/vehicles.spec.ts`). A dev dependency goes in `e2e/package.json` only, named in the commit with its reason.
- Never skip, disable or weaken a test. Block map tiles in browser tests as test-35 does.
- A finding counts only with a proof: exact request / command / click path, expected (with the spec or AGENTS.md rule), actual, the file and line you believe is the cause. Otherwise it goes under "Suspected, not proven".
- Severity: **critical** (a stock, sale, balance or cash figure wrong; a truck or driver history of another tenant readable or writable; a `vehicle_assignments` row changed or lost; the backfill writing a guessed truck), **high** (500 on valid or hostile input, scope bypass inside a tenant, feature gate bypass, a driver change that leaves two trucks on one driver or a truck tournée shown to the wrong driver, a screen unusable at 360 px), **medium**, **low**. Each critical / high gets a short fix proposal (what to change, which test would lock it). Do not fix.

### Before you start
Record in the report: commit hash, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, the e2e Playwright projects (counts, time). Then seed test data with a script under `e2e/` (not the app seed), **inviting every user through `POST /users/invite`** (audit-02 A-1 showed that users inserted straight into the DB hide bugs):
- tenant A (edition Distribution): owner, manager, a supervisor with a team of two sellers, a seller outside the team, two livreurs, a storekeeper; a main dépôt, a secondary dépôt, five trucks across two dépôts (CASH_VAN, PRESALE, DELIVERY, MIXED, one without type), vehicle types with and without `codePrefix`, one archived type;
- tenant B with the **same** type codes and truck codes as A;
- a tenant on Essentiel (no `WAREHOUSES` / `TOURNEES`);
- history before phase 36 for the backfill: old seller routes, visits linked to van sales, orders delivered by a truck, orders delivered from the main dépôt, visits with neither.

### Part A — API correctness (`e2e/api/vehicles.ts`)
- **Vehicle types**: CRUD, code 1 / 20 / 21 chars, case-insensitive uniqueness per tenant (`MXT` vs `mxt`), same code allowed in tenant B, archive refused while a live truck uses it (`VEHICLE_TYPE_IN_USE`), archived type not offered for a new truck, audit rows.
- **Truck identity**: `code` unique per tenant among live warehouses (case-insensitive), allowed again after the first truck is archived; identity fields refused on MAIN / SECONDARY except `code` (`VEHICLE_FIELDS_ON_DEPOT`), in the API **and** by the DB CHECK (write it with SQL as the app role); wilaya 0 / 1 / 69 / 70; `capacityKg` 0 / -1 / huge; plate 20 / 21 chars. Code helper: next free number with gaps (01, 02, 04 → 03 or 05? say what the spec says), no prefix, the owner's own text kept, Arabic and spaces in a code.
- **Driver change** (`POST /warehouses/:id/driver`): one `vehicle_assignments` row per change in the same transaction (force a failure after the row and check rollback leaves none); moving a driver who has another truck frees it with a second row; `userId: null` leaves the truck without driver; an open `SellerSession` of the old driver blocks it (`SESSION_OPEN_ON_VEHICLE`); the dépôt form still refuses `VEHICLE_ALREADY_ASSIGNED`. **Check every path that changes `assignedUserId`** (warehouse create, update, archive, quick-assign, any other you find with the graph): each writes a row, none writes `assigned_user_id` without one (SQL truth query: for every truck, the last row's `userId` equals `assignedUserId`).
- **History helpers**: `driverAt` / `vehicleAt` across three changes, at the exact `fromAt`, one millisecond before, and in the future. `GET /users/:id/vehicle-assignments`: periods and `toAt` right (driver A truck 1 → truck 2 → truck 2 to B: A has two closed periods, B one open), cursor pagination stable under inserts, a truck outside the reader's reach shown by code without a link.
- **Append-only**: `UPDATE` and `DELETE` on `vehicle_assignments` as the app role and as the owner role are refused by the trigger.
- **Tournées per vehicle**: a vehicle route appears in "aujourd'hui" (`/me/today` or its endpoint) for the current driver and **stops** for the previous one right after the change, with no route edit; old seller routes still work; a route with neither vehicle nor seller refused (API and CHECK); a route with a vehicle stores `sellerId` null; convert one (`SELLER_HAS_NO_VEHICLE` when he drives none) and bulk (count, idempotent second run = 0, audit `ROUTE_CONVERTED`).
- **Frozen truck**: `Visit.vehicleId` = the truck at `startedAt`, a correction visit copies it, a later driver change does not change it; `Order.vehicleId` at creation, `deliveryVehicleId` at delivery; an order assigned to a delivery truck follows the truck when its driver changes before delivery, and "Mes livraisons" of the new driver shows it, the old one's no longer.
- **Stock and money stay right** (the critical part): a sale by a driver after a driver change takes stock from **the truck he drives now**, not his old one nor the dépôt principal (A-1); chargement / déchargement after a change; a clôture (seller session) opened on truck 1 then a move to truck 2: what happens to the cash and stock responsibility? After a full scenario, `pnpm --filter @erp/api reconcile` reports no difference and every truck's stock equals the sum of its movements.
- **Livreurs drive trucks** (new decision): a livreur on a DELIVERY truck can deliver orders, cannot sell from it unless the existing rules allow it; prove which.
- **Activity is only a hint**: a PRESALE truck can still do whatever phases 15–16 allowed before (spec), nothing newly blocked.

### Part B — Scope, isolation and security
- **Tenant isolation** on every new route (types, trucks, driver, assignments, user history, convert, report `?by=vehicle`, filters): tenant A with B's ids in the path, query **and body** (`vehicleTypeId`, `vehicleId`, `deliveryVehicleId`, `userId`): 404 / 400, never a B row read or written. Same codes in A and B never collide.
- **Scope inside a tenant** (`tournee-scope.ts`): supervisor sees and edits routes of his team's trucks and of dépôts he OPERATEs, not others (list, get, update, convert, driver change, history); a seller cannot change drivers nor read another seller's vehicle history; a manager limited to one dépôt (phase 24); the storekeeper. Compare sets of ids with a SQL truth query, not counts.
- **Permissions**: `SETTINGS_EDIT` for types; who may call `POST /warehouses/:id/driver`; the user history readable by planners in scope and the user himself only.
- **Feature gate**: Essentiel tenant → types, trucks identity, driver routes and vehicle reports refused.
- **Hostile input** (reuse audit-02 B-4 style): very long codes, control characters, lone surrogates, RTL override characters (U+202E) in a code or plate, `wilayaCode` as string / float / huge: 400, never 500.
- Idempotency and audit: a replayed driver change or convert does not write a second row; every write has its audit row with before / after.

### Part C — Concurrency
- Two driver changes on the same truck at once (`Promise.all`, 20 rounds): one consistent end state, the last row matches `assignedUserId`, no driver ends on two trucks.
- Cross moves: A → truck 2 and B → truck 1 at the same time while A had truck 1 and B truck 2: no deadlock (row locks in id order), no lost row.
- A driver change racing a sale or a visit start by the old driver: which truck do the sale and the visit get? It must be one of the two consistently, never stock from one truck and `vehicleId` of the other.
- Bulk convert racing a route edit.

### Part D — Backfill and upgrade (local, scratch DB)
- Restore a copy of the pre-36 schema with the history from "Before you start", run the migration, then `db:backfill-vehicles` twice: first run fills `Visit.vehicleId` from the linked sale's truck else the order's, `Order.deliveryVehicleId` from the BL's truck; rows that cannot be known stay null; **no row guessed from today's driver**; second run changes 0. The initial `vehicle_assignments` rows: one per truck with a driver, `reason = 'backfill'`, `fromAt` = truck `updatedAt`. Write the truth SQL in `e2e/sql/`.
- The migration on a live table: the CHECK constraints and indexes on `warehouses`, `routes`, `visits`, `orders`: lock time on 50 000 visits / orders locally; does the old web (main before #72) still work against the new API (additive DTOs)?
- README / runbook: the Neon block (`db:deploy`, build, backfill twice, reconcile) is there and correct. Do not run it on Neon; say in the report whether the owner confirmed it.

### Part E — Web and phone (`e2e/web/vehicles.spec.ts`)
Run at 360 and 393 px in `ar` (RTL) and `fr`, plus 1280 px in `fr`.
- Types de véhicules: list, empty state with the field examples, form, archive refused message.
- Véhicules: cards (code big, type badge, wilaya, plate, today's driver, "Changer"), filters, form with "Proposer un code", driver sheet with the "already has a truck" confirm, history sheet, "Véhicules conduits" on a user.
- Tournées: create asks "Véhicule" first, link "pour un vendeur", list grouped by vehicle, "Convertir" and the bulk banner with the count.
- Aujourd'hui: truck header ("VAN-28 MXT 01 · M'sila"); a seller without truck sees the old message and his seller routes.
- Orders / delivery: filter and assign by delivery truck.
- **Bidi**: `VAN-28 MXT 01`, `VAN34-SELF/MT`, `LIV 28 MIX`, a code with an Arabic word, and a plate with digits keep their order inside Arabic sentences, in lists, toasts, selects and the PDF / print views if any show the truck. Screenshot each.
- **Wilayas**: the list has 69 unique numbers; names 1–58 match the official list; for 59–69 write down the names the app shows and the source the code cites, and list them as "to confirm by the owner" (PR #72 says they come from press reports). Do not mark a name wrong without an official source.
- No horizontal scroll, sticky main action visible, focus trapped in sheets, Escape closes, no raw i18n key on screen in ar / fr / en.
- Screenshots of every state in `e2e/artifacts/test-36/`.

### The report
`e2e/REPORT-36.md`, in English, same layout as `e2e/REPORT-35.md`: what was tested, how to rerun (one command per part), baseline, results table, findings (critical and high first, each with proof file in `e2e/artifacts/test-36/`), what holds up well, what you could not test and why. Also list what PR #72 left out (per-vehicle report screen, Lighthouse Performance) as known, not as findings. End with **go / no-go for phase 37 to build on these columns** and a **fix plan** (small PRs in order, each with the test that would lock it). Do not open the fix PRs.

### Definition of done
- Parts A to E are in the report, or a part is listed as not done with the reason.
- Every finding reruns with one command.
- `git diff --stat origin/main -- apps packages` is empty.
- The new suites pass or fail only on the findings they prove; `pnpm lint && pnpm typecheck && pnpm test` still pass.
- No request other than an anonymous `GET` was sent to production.
- A PR `test/phase-36-vehicle-first` with: What was tested, How to rerun, Findings (count by severity), Decisions, Not done.
