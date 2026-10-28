Read AGENTS.md and docs/domain.md (Sales force & distribution) before doing anything.

## Task: Phase 14 — Sales force foundation: sellers, teams, brands, sectors

Branch: `phase-14-sales-force`. Phases 1–13b and 21 are merged.

This phase lays the data every later field phase needs (tournées, GPS, objectives, mobile). Feature flag: `SALES_FORCE` for sectors, client assignment, scoping and team screens. `Sale.sellerId`, `Payment.collectedBy` and brands are **core** (all plans).

### Domain rules to respect
- **Who made the sale**: `Sale.sellerId` (nullable). Defaults to the creator when the creator is a SELLER; office users pick the seller on the sale screen. It is frozen at validation like the price (AGENTS rule 9). Changing it on a validated sale needs the new permission `SALE_REASSIGN_SELLER`, takes a reason and is audited (before/after). Phase 18 will refuse it once the month's incentives are approved: put the check in one service method `assertSellerChangeAllowed` that allows everything for now.
- **Who collected the money**: `Payment.collectedBy` (nullable), defaults to `receivedBy` when the receiver is a SELLER. Same reassign rule.
- **Team hierarchy**: `User.managerId` (nullable). New roles `SUPERVISOR` and `LIVREUR` (Prisma enum + `packages/shared/enums.ts` + `ROLE_PERMISSIONS`). A user cannot be his own manager, and a cycle (A → B → A) is refused with `MANAGER_CYCLE`, checked with a recursive CTE inside the transaction.
- **Brands (marques)**: `Brand` master data (tenantId, name unique per tenant, supplierId optional, soft delete). `Product.brandId` nullable. The product Excel import accepts an optional "Marque" column; unknown brands are created like categories.
- **Sectors**: `Sector` (tenantId, name, wilaya, communes text[]). `Client.sectorId`, `Client.assignedSellerId` (both nullable). Bulk assign: select clients → set sector / seller (audited).
- **Data scoping** (tenant setting `sellerScope`: `ALL_CLIENTS` default, `ASSIGNED_ONLY`):
  - SELLER with `ASSIGNED_ONLY`: sees and sells only to his assigned clients and the client comptoir; his own sales and payments.
  - SUPERVISOR: everything of the users in his subtree.
  - MANAGER / OWNER: everything.
  - Enforced in the services through one shared helper (e.g. `ScopeService.clientFilter(user)`), never only in the web. A client outside scope returns 404 (do not reveal it exists).
- Default for existing tenants must not change behaviour: `ALL_CLIENTS`, no sectors, sellerId null on old sales.

### API
- CRUD `brands`, `sectors`; `PATCH /clients/bulk-assign`; `PATCH /users/:id` accepts `managerId`.
- `PATCH /sales/:id/seller`, `PATCH /payments/:id/collector` (permission + reason).
- Reports: sales by seller, by brand, by sector (period, HT/TTC, quantity), team totals for a supervisor. Excel export.

### Web
- Users page: manager column, team tree view.
- Brands and sectors pages; product form brand select; client form sector + assigned seller; bulk assign from the client list.
- Sale screen: seller select (prefilled), visible to office roles.
- Dashboard: filter by seller / team / brand.
- All strings in ar / fr / en.

### Tests
- Integration: sellerId frozen and reassign rules; collectedBy defaults; manager cycle refused (direct and indirect); scoping for SELLER / SUPERVISOR / MANAGER on clients, sales, payments, reports (a seller reading another seller's client by id gets 404); `SALES_FORCE` off → sectors routes refused but sellerId still works; Excel import with brands, run twice creates no duplicate brand; tenant isolation.

### Not in this phase
Warehouses and trucks (15), tournées and visits (16), GPS (17), objectives (18).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (15 Multi-dépôts & véhicules).
