Read AGENTS.md, docs/ui.md, docs/domain.md (Stock, Tournées) and docs/architecture.md before doing anything. Then read `apps/api/prisma/schema.prisma` (`Warehouse`, `Route`, `RouteStop`, `Visit`, `Order`, `SellerSession`, `StockTransfer`), `apps/api/src/stock/warehouses.service.ts` (`create`, `update`, `checkDriver`, the truck of a user), `apps/api/src/tournees/routes.service.ts`, `visits.service.ts`, `orders.service.ts`, `seller-sessions.service.ts`, `tournee-scope.ts`, `tournee-reports.service.ts`, `apps/api/src/sales-force/scope.service.ts`, `apps/api/src/common/business-unit-sql.ts`, `packages/shared/src/schemas/warehouses.ts`, `tournees.ts`, `packages/shared/src/features.ts`, `permissions.ts`, and on the web `apps/web/src/components/tournees/` (`routes-list.tsx`, `route-editor.tsx`, the "aujourd'hui" page) and the dépôts settings screen. Use the `/graphify` graph first to find anything else these touch.

## Task: Phase 36 — Distribution par véhicule

Branch: `phase-36-vehicle-first-distribution`. Phases 1–18, 20–22, 24–26, 30–31b and 33–35 are merged. Phases 19, 23, 27, 28, 29 and 32 are **not** built: do not build any part of them here. Production is Vercel + Neon: no VPS, no timers, no background jobs.

### Why
Big distributors do not follow the worker, they follow the **truck**. Sellers and drivers leave after a few months; the truck "VAN-28 MXT 01" stays, keeps its zone, its clients, its targets and its history. Today a tournée (`Route.sellerId`) and a visit (`Visit.sellerId`) belong to a **user**, so when the seller changes, the tournée has to be rebuilt and the history of the zone is split across people. This phase makes the **vehicle** the unit of distribution:
- the owner gives each truck a **code** and a **type** he invents himself (examples from the field: `VAN-28 MXT 01` = van, wilaya 28 M'sila, gros + détail; `VAN34-SELF/MT`; `VAN 28-HRC 01`; `LIV 28 MIX` = livreur; `PRV05-DD01` = prévendeur). **We never hard-code these codes or types**: the tenant creates them;
- a **tournée is planned for a vehicle**, not for a person; whoever drives the truck today does its tournée;
- every visit, order and closing remembers **which truck** it was done with, so phase 37 can build statistics per vehicle, per type, per dépôt and per wilaya that survive staff turnover.

A truck is already a dépôt (`Warehouse.type = VEHICLE`, phase 15) with its own stock, chargement and déchargement. Keep that: this phase adds identity and history to it, it does not create a second "vehicle" table.

### Domain rules
- **Feature**: everything here needs `Feature.WAREHOUSES` (vehicles) and, for tournées, `Feature.TOURNEES`, both already in the DISTRIBUTION and ENTREPRISE editions. No new feature flag.
- **Vehicle types are tenant data.** A `VehicleType` has the owner's own `code` (1–20 chars, e.g. `MXT`, `SELF/MT`, `HRC`, `MIX`), a `name` ("Gros + détail") and an **activity** chosen from a short list that *we* define because the software behaves differently for each:
  | Activity | Meaning | Used by |
  |---|---|---|
  | `CASH_VAN` | Vente directe: loads stock, sells and collects on the road | BL from the truck stock |
  | `PRESALE` | Prévente: takes bons de commande, carries no stock to sell | orders, no BL from its stock |
  | `DELIVERY` | Livraison: delivers confirmed orders | order delivery |
  | `MIXED` | Does several of the above | all |
  The activity is a hint for screens and statistics in this phase (which tabs and KPIs make sense); it **does not block** an operation that phases 15–16 allow today (do not break the current flows). Archive, never delete (master data, `deletedAt`); a type used by a live truck cannot be archived (`VEHICLE_TYPE_IN_USE`).
- **Vehicle identity** (VEHICLE warehouses only; the API refuses these fields on MAIN / SECONDARY, except `code`): `code` (owner text, 1–30 chars, unique per tenant among live warehouses, case-insensitive; dépôts may have a code too, e.g. `CDD BATNA 05`), `vehicleTypeId`, `wilayaCode` (1–69, see below), `plateNumber` (matricule, optional, free text up to 20), `capacityKg` (optional integer, used by phase 37 for the fill rate). The existing `name` stays the display label; the list and pickers show `code · name` when a code exists.
- **Code helper, not a rule**: the vehicle form proposes a code built from the type and the wilaya (e.g. type `MXT` + wilaya 28 → `VAN-28 MXT 01`, next free number) that the owner can change freely. The prefix (`VAN`, `LIV`, `PRV`) is a per-type optional `codePrefix` the owner sets. Never parse a code to get meaning back: the meaning lives in the columns.
- **Wilaya**: `packages/shared/src/wilayas.ts` with the official list of wilaya numbers and names (fr + ar). Algeria went from 58 to 69 wilayas with the 2025 reform: use the official current list, and if you cannot confirm a name with certainty, keep the number and write the doubt under "Decisions" instead of guessing. Store the number (`SmallInt`), never the name.
- **Crew history: who drove which truck, and when.** The truck's current driver stays `Warehouse.assignedUserId` (phase 15, one active truck per user, `VEHICLE_ALREADY_ASSIGNED`). New append-only table `VehicleAssignment` (`vehicleId`, `userId` nullable = truck left without driver, `fromAt`, `setBy`, `reason` optional): **every** change of `assignedUserId` (create, update, archive, the new quick-assign below) writes a row in the same transaction. "Who had truck X at time T" = the last row with `fromAt <= T`. Never update or delete a row (DB trigger like the other ledgers). Backfill one row per truck that has a driver today, `fromAt` = the truck's `updatedAt`, `reason = 'backfill'`.
- **Quick re-assignment**: the owner / manager / supervisor can change today's driver of a truck in two taps from the vehicles list and from the tournées page ("Qui conduit aujourd'hui ?"). Moving a driver who already has another truck asks to confirm and frees the other truck in the same transaction (two `VehicleAssignment` rows). An open `SellerSession` of the old driver on that truck blocks the change (`SESSION_OPEN_ON_VEHICLE`): close the day first, money responsibility must stay clear.
- **Tournées per vehicle**:
  - `Route.vehicleId` (new, nullable, a live VEHICLE warehouse). `Route.sellerId` becomes **nullable** (expand step only: drop `NOT NULL`, keep the column and every current read). A CHECK constraint requires `vehicleId IS NOT NULL OR sellerId IS NOT NULL`.
  - New routes are created **for a vehicle** by default; the form still allows "pour un vendeur" (old behaviour) for tenants without trucks. A route with a vehicle ignores `sellerId` for planning (store it null).
  - "Ma tournée du jour" (`/tournees/aujourdhui` and the API behind it) = the active routes of today's weekday whose `vehicleId` is the truck the user drives **now**, plus the old routes with `sellerId = user.id`. When the driver changes, the new driver sees the truck's tournée at once, with no edit.
  - Scope (phase 14/24): a planner sees and edits a vehicle route when the vehicle's dépôt is in his reach (owner and `VIEW_ALL_WAREHOUSES` all; supervisor: trucks of his team members or of the dépôts he has OPERATE on). Write the rule once in `tournee-scope.ts` and test it.
  - "Convertir en tournée véhicule" on an old seller route: sets `vehicleId` = the seller's current truck (refused when he has none), clears `sellerId`, audit `ROUTE_CONVERTED`. A bulk action converts all routes of sellers who drive a truck, after a confirm showing the count.
- **Freeze the truck on each operation** (rule 9 spirit: history never changes when the crew changes):
  - `Visit.vehicleId` (new, nullable): set at creation to the truck the seller drives at `startedAt`; null when he has none. A correction visit copies it.
  - `Order.vehicleId` (new, nullable): the prévendeur's truck at creation; `Order.deliveryVehicleId` (new, nullable): the truck that delivered it, set at delivery (the BL's dépôt when it is a truck).
  - `SellerSession.warehouseId` already holds the truck: no change.
  - `Sale.warehouseId` already holds the truck for van sales: no change.
  - Backfill (idempotent CLI `pnpm --filter @erp/api db:backfill-vehicles`, like `warehouse-backfill.cli.ts`): `Visit.vehicleId` from the linked sale's `warehouseId` when it is a truck, else from the order's; `Order.deliveryVehicleId` from its BL's `warehouseId` when it is a truck. Rows that cannot be known stay null and are shown as "Véhicule inconnu" later. **Never guess** from today's driver. Run it twice in the tests: the second run changes 0 rows.
- **Orders for delivery trucks**: the order list and the delivery screen can filter and assign by delivery vehicle (`DELIVERY` / `MIXED` trucks). Assigning sets the existing `Order.livreurId` to the truck's current driver **and** stores `deliveryVehicleId`; if the driver changes before delivery, the order follows the truck (the new driver sees it). Keep every current order rule (one BL per order, idempotency, row locks).
- **Audit**: `VEHICLE_TYPE_CREATED/UPDATED/ARCHIVED`, `VEHICLE_DRIVER_CHANGED` (before/after user, truck), `ROUTE_CONVERTED`, plus the existing warehouse and route audits with the new fields in before/after.

### Architecture
- One owner per concept: vehicle types, vehicle identity and `VehicleAssignment` live in the stock / warehouses module behind an exported `VehiclesService` (`currentVehicleOf(userId)`, `vehicleAt(vehicleId, t)`, `driverAt(vehicleId, t)`, `vehiclesOf(userId, cursor)`, `assignDriver(tx, …)`). Tournées, visits, orders and sessions call it; nobody else queries `vehicle_assignments` or writes `assignedUserId` (remove the direct writes from other services, keep their behaviour).
- `assignDriver` is the **only** path that changes a driver; it takes the caller's transaction so a route conversion or a warehouse update stays one business operation (rule 3).
- Freezing the truck on visits / orders goes through one helper used at creation, so phase 37 can trust the column.
- The CHECK constraints and the append-only trigger enforce the rules in the DB too, not only in services.

### Schema (one migration, additive only; expand step)
- `enum VehicleActivity { CASH_VAN PRESALE DELIVERY MIXED }`.
- `vehicle_types`: `id, tenantId, code VarChar(20), name VarChar(80), codePrefix VarChar(10)?, activity VehicleActivity, active, deletedAt, createdAt, updatedAt`; partial unique `(tenantId, lower(code)) WHERE deletedAt IS NULL`; RLS policy like the other tenant tables (the `rls.int-spec` check must stay green).
- `warehouses`: `code VarChar(30)?`, `vehicleTypeId Uuid?` (FK Restrict), `wilayaCode SmallInt?` (CHECK 1..69), `plateNumber VarChar(20)?`, `capacityKg Int?` (CHECK > 0); partial unique `(tenantId, lower(code)) WHERE code IS NOT NULL AND deletedAt IS NULL`; index `(tenantId, vehicleTypeId)`.
- `vehicle_assignments`: `id, tenantId, vehicleId, userId?, fromAt Timestamptz, setBy Uuid?, reason VarChar(120)?, createdAt`; index `(tenantId, vehicleId, fromAt DESC)`; append-only trigger; RLS.
- `routes`: `vehicleId Uuid?` + index `(tenantId, vehicleId)`; `sellerId` drop NOT NULL; CHECK `vehicleId IS NOT NULL OR sellerId IS NOT NULL`.
- `visits`: `vehicleId Uuid?` + index `(tenantId, vehicleId, startedAt)`.
- `orders`: `vehicleId Uuid?`, `deliveryVehicleId Uuid?` + index `(tenantId, deliveryVehicleId, status)`.
- Nothing is renamed or dropped. The old web keeps working against the new API during the deploy (every DTO change additive).
- After merge: `pnpm --filter @erp/api db:deploy` on Neon, then `pnpm --filter @erp/api db:backfill-vehicles` twice (2nd = 0 changes), then `pnpm --filter @erp/api reconcile`. Write this block in the PR "How to test" and in the summary.

### API
- `packages/shared/src/schemas/vehicles.ts`: zod for vehicle types, vehicle identity fields (extend `createWarehouseSchema` / `updateWarehouseSchema` additively), `assignDriverSchema`, route `vehicleId`. Error codes in `packages/shared/errors.ts`: `VEHICLE_TYPE_IN_USE`, `VEHICLE_CODE_TAKEN`, `VEHICLE_FIELDS_ON_DEPOT`, `SESSION_OPEN_ON_VEHICLE`, `ROUTE_NEEDS_OWNER`, `SELLER_HAS_NO_VEHICLE`.
- `GET/POST/PATCH /vehicle-types`, `POST /vehicle-types/:id/archive`: `SETTINGS_EDIT` + `Feature.WAREHOUSES`.
- `GET /warehouses?type=VEHICLE&vehicleTypeId=&wilayaCode=&search=` (search on code, name, plate) returns the new fields; `POST/PATCH /warehouses` accept them.
- `POST /warehouses/:id/driver` `{ userId | null, reason? }`: planners in scope; row-locks both trucks in id order; writes the assignment rows and the audit. `GET /warehouses/:id/assignments` (cursor pagination).
- `GET /users/:id/vehicle-assignments` (cursor pagination): the trucks a worker drove, newest first, each as a period `{ vehicle (id, code, name, type), fromAt, toAt | null (still driving), setBy }`. `toAt` = the `fromAt` of the next row **on the same truck** (whoever it names, a null driver included). Derived from `vehicle_assignments` only, no new table or column. Readable by the planners who can see that user (phase 14/24 scope, owner and `VIEW_ALL_WAREHOUSES` all) and by the user himself; trucks outside the reader's reach still appear by code, without a link.
- Routes: `vehicleId` in create / update / list filters; `POST /routes/:id/convert-to-vehicle`, `POST /routes/convert-to-vehicle` (bulk, returns the count; idempotent: running it again converts 0).
- Visits / orders: set the frozen vehicle columns in the existing services; add `vehicleId` / `deliveryVehicleId` filters to the list endpoints and to `tournee-reports.service.ts` (visit report by vehicle as well as by seller).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), `ResponsiveDialog`, sticky main action, card lists below `md`. Load the UI / design skills before building screens and run the audit skill on the changed pages at the end.
- **Paramètres → Types de véhicules**: list + form (code, nom, préfixe, activité with a one-line explanation of each). Empty state explains with the field examples (`MXT` gros + détail, `SELF/MT`, `MIX` livreur) that these are the company's own codes.
- **Véhicules** (the existing dépôts screen, VEHICLE tab, or its own entry under Stock): card per truck: code (big), type badge, wilaya, plate, today's driver with a "Changer" button, stock value shortcut. Filters type / wilaya / dépôt. Form with the code helper ("Proposer un code").
- **Driver history** sheet on a truck: who drove it, from when, set by whom.
- **Vehicle history of a worker**: on the user's fiche (Équipe / Utilisateurs) a "Véhicules conduits" section: one row per period (code, type, du … au …, "en cours" for today's truck), tapping a row opens that truck. Empty state when he never drove one. The owner follows the worker across trucks as well as the truck across workers.
- **Tournées**: the create form asks "Véhicule" first (picker shows `code · type · driver`), with a link "Tournée pour un vendeur (sans véhicule)". The list groups by vehicle and shows the driver of today next to it. Old seller routes show a "Convertir" action and a banner with the bulk conversion when some exist.
- **Aujourd'hui**: the header names the truck ("VAN-28 MXT 01 · M'sila") above today's stops; a seller without a truck sees the current message plus his old seller routes.
- Orders / delivery screens: filter and assign by delivery truck.
- Strings in `ar`, `fr`, `en` (key-parity test green). Vehicle codes are shown as typed (never translated), in a `dir="ltr"` span inside RTL text so `VAN-28 MXT` does not get reversed.

### Tests
- Unit (shared): wilaya list (69 entries, unique numbers), code helper (next free number, prefix optional, keeps the owner's text), zod schemas (code length, wilaya range, identity fields refused on a dépôt).
- Integration (API, real DB):
  - vehicle types CRUD, archive refused when in use, code unique per tenant case-insensitive, another tenant may reuse the same code;
  - driver change writes `VehicleAssignment` rows in the same transaction (rollback leaves none), moving a driver frees his old truck, an open session blocks it, two concurrent changes on the same truck end in one consistent state (row lock);
  - "who had truck X at T" helper returns the right user across three changes;
  - a worker's vehicle history: driver A on truck 1, moved to truck 2, then truck 2 given to B → A's history has two closed periods with the right dates, B's one open period; a supervisor outside A's scope gets 403, A himself reads his own;
  - a vehicle route shows in "aujourd'hui" for the current driver and **stops** showing for the previous one right after the change, with no route edit; an old seller route still works;
  - convert one / bulk is idempotent and audited; a seller without truck → `SELLER_HAS_NO_VEHICLE`;
  - visits and orders store the truck at creation; a later driver change does not change them;
  - backfill: fills from sales / orders, leaves unknown null, second run 0 changes;
  - scope: a supervisor cannot see or edit a route of a truck outside his reach; a seller cannot change drivers;
  - tenant isolation: tenant A cannot read B's vehicle types, trucks, assignments or vehicle routes, nor use B's `vehicleTypeId` / `vehicleId` in a body;
  - feature off (Essentiel) → vehicle types and driver routes refused.
- Playwright mobile (`e2e/web/mobile.spec.ts`): types list + form, vehicles list, driver change sheet, tournée form with the vehicle picker, "aujourd'hui" header, at 360 and 393 px in `ar` and `fr`, no horizontal overflow, a `VAN-28 MXT 01` code renders in the right order in Arabic.
- Playwright (`e2e/web/web.spec.ts`): create a type → create a truck with the proposed code → plan a tournée for it → driver A sees it today → change driver to B → B sees it, A does not.

### Not in this phase
Statistics per vehicle (phase 37), per-vehicle targets (phase 37), several crew members per truck (driver + seller + helper; decided 2026-11-12: one responsible person per truck), fuel / kilometres / maintenance of trucks (a fleet module), live GPS tracking of trucks, the contract step that makes `Route.vehicleId` required (later release, after every tenant converted). List them under "Parked ideas".

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually (including the `db:deploy` + `db:backfill-vehicles` block on Neon) / Decisions / Next phase (37).
