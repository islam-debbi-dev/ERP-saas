Read AGENTS.md, docs/domain.md (Sales force & distribution, Clients & credit) and docs/architecture.md before doing anything. Read `packages/shared/src/permissions.ts`, `apps/api/src/sales-force/scope.service.ts`, `apps/api/src/users`, `apps/api/src/stock` (warehouses) and `apps/api/src/payments` fully: this phase changes who sees what everywhere.

## Task: Phase 24 — Dépôts as business units: teams, fine permissions, cross-dépôt stats access

Branch: `phase-24-warehouse-teams-access`. Phases 1–23 are merged. Feature flag: new `MULTI_UNIT` (editions DISTRIBUTION and ENTREPRISE). A tenant without it sees no change.

The need: one company runs a dépôt "Vaisselle" (brand A) and a dépôt "Vêtements" (brand B). Each dépôt has its own team (manager, supervisor, sellers, each with an account). The owner decides who may do what, and whether the manager of dépôt A may see dépôt B's figures.

### Design (decided with islam, 2026-11-01)
- **One company, one tenant.** A `MAIN` / `SECONDARY` warehouse is a business unit. Products, clients, price levels and CUMP stay company-wide.
- **One client account across dépôts.** The client ledger stays one per client (no split balances, no second plafond). Each new `ClientLedgerEntry` and `Payment` records the dépôt it belongs to, so debts and cash can be shown per dépôt.
- **One role per user** (the existing `Role`), valid in every dépôt he belongs to. Hierarchy stays `User.managerId`.
- **What a dépôt sells**: `WarehouseBrand` and `WarehouseCategory` (pairs). Empty = sells everything. A sale or order line on a product outside its dépôt's brands/categories is refused (`PRODUCT_NOT_IN_WAREHOUSE`) unless the user has `SELL_ANY_PRODUCT`.
- `Warehouse.managerUserId` (the dépôt's manager, optional) and `Warehouse.parentWarehouseId` (a VEHICLE belongs to one dépôt; it inherits its team and brands).
- **Access, two axes:**
  1. *What you may do*: the permission catalog grows from 12 sensitive actions to module permissions (view / create / edit / cancel where they make sense) for products, stock, purchases, suppliers, clients, sales, versements, reports, users, settings, plus the new `SELL_ANY_PRODUCT`, `WAREHOUSE_ACCESS_MANAGE`, `VIEW_ALL_WAREHOUSES`. Roles stay templates with defaults chosen so that **every current user keeps exactly what he can do today** (write a test that proves it role by role). The owner keeps everything. Grants/revokes per user as today.
  2. *Where you may do it*: `UserWarehouseAccess` (tenantId, userId, warehouseId, level `OPERATE` | `VIEW_STATS`, grantedBy, grantedAt; unique on user + warehouse). `OPERATE` = he works there (sells, receives, sees documents). `VIEW_STATS` = he sees that dépôt's aggregated figures (dashboard, reports, overview) but no single document, client ledger detail or user list. OWNER and users with `VIEW_ALL_WAREHOUSES` see all dépôts. Granting or revoking is audited.
- `ScopeService.of()` returns two more lists: `warehouseIds` (OPERATE) and `statsWarehouseIds` (OPERATE ∪ VIEW_STATS), null = all. **Every** query on sales, returns, purchases, orders, versements, stock, transfers, reports and dashboard applies them in the service, in one place, like the seller scope. The web only hides.
- A user with OPERATE on exactly one dépôt gets it as default everywhere (sale, BR, versement); no selector shown.

### Migration (expand → backfill → contract, like phase 15)
1. Expand: new tables, nullable `warehouseId` on `Payment` and `ClientLedgerEntry`, `managerUserId`, `parentWarehouseId`. New code always writes them (a versement's dépôt = the user's single OPERATE dépôt, else the one chosen on the screen, else the sale's dépôt for a versement at sale, else the default MAIN).
2. Backfill script `db:backfill-units` (idempotent, run twice in CI): payments get the dépôt of the sale they pay (allocation, oldest first) else the default MAIN; ledger entries get the dépôt of their source document; every existing user gets OPERATE on every existing MAIN/SECONDARY dépôt (nobody loses access); trucks get the default MAIN as parent. Print counts before/after; abort on a mismatch.
3. Contract (NOT NULL) written in this PR, shipped in a later release.

### API
- `PUT /warehouses/:id/brands`, `PUT /warehouses/:id/categories`, `PATCH /warehouses/:id` (manager, parent).
- `GET /users/:id/access`, `PUT /users/:id/access` (list of {warehouseId, level}), owner or `WAREHOUSE_ACCESS_MANAGE`; refuses to give more than the granter has.
- `GET /me` returns permissions, `warehouseIds`, `statsWarehouseIds`.
- `?warehouseId=` filter on lists, reports and dashboard; a dépôt outside the user's reach returns nothing, never an error that leaks its existence.
- New error codes in `packages/shared/errors.ts`.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Dépôt page: brands, categories, manager, team (members with role), trucks.
- User page: permissions as a checkbox grid grouped by module, with "role default" marked and a reset button; a "Dépôts" block with, per dépôt, None / Voir les statistiques / Travailler.
- Header: dépôt switcher ("Tous les dépôts" + the ones he can see), remembered per user, filtering every list and report. Hidden for a user with one dépôt.
- Sale / order product search shows only the dépôt's products.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: effective permissions (role defaults, grants, revokes, owner); the "nobody loses a right" table per role.
- Integration: a seller of dépôt A cannot list, read or create a sale, versement or BR in dépôt B; a VIEW_STATS user gets B's dashboard totals but 404 on a B sale and an empty B document list; a sale of a product outside the dépôt is refused, allowed with `SELL_ANY_PRODUCT`; client balance unchanged by the backfill and still equals the ledger; per-dépôt debt sums to the client balance; backfill twice = same result; flag off → phase 1–22 tests unchanged; tenant isolation on every new table (RLS policy + the rls int-spec check).

### Not in this phase
Separate client accounts or plafonds per dépôt, inter-dépôt invoicing / transfer pricing, a different role per dépôt (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (25 Charges et loyers).
