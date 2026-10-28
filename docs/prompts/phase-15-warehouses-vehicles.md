Read AGENTS.md, docs/domain.md (Products & units, Sales force & distribution) and docs/architecture.md (Concurrency) before doing anything. Read `apps/api/src/stock` fully: this phase changes the stock core.

## Task: Phase 15 — Multi-dépôts and vehicle stock (chargement / déchargement)

Branch: `phase-15-warehouses-vehicles`. Phases 1–14 are merged. Feature flag: `WAREHOUSES` (a tenant without it keeps one implicit dépôt and sees no change).

This is the riskiest migration so far: production has real stock. Work in the three steps below, one commit each, all tests green after each.

### Design (decided)
- `Warehouse` (tenantId, name, type `MAIN` / `SECONDARY` / `VEHICLE`, assignedUserId for vehicles, active, soft delete). Each tenant gets exactly one default `MAIN` warehouse (`isDefault`).
- **CUMP stays per product for the whole company.** `ProductStock` keeps the total quantity and the CUMP, unchanged. A new `WarehouseStock` (tenantId, warehouseId, productId, qtyBase; unique on the pair) holds the split per dépôt, updated in the same transaction as the movement. Sum of `WarehouseStock` = `ProductStock.qtyBase`, always (reconcile job checks it).
- `StockMovement.warehouseId` (nullable during the expand step, then required). A transfer writes two movements, `TRANSFER_OUT` and `TRANSFER_IN` (new `StockMovementType` values), same quantity, same unit cost = current CUMP, so the total stock and the CUMP do not move.
- **Lock order** (avoid deadlocks): lock `ProductStock` rows by productId, then `WarehouseStock` rows by (productId, warehouseId), always in this order, in every path (sale, purchase, return, adjustment, transfer, inventory).
- `negativeStockMode` applies per warehouse.

### Migration steps
1. **Expand**: create `Warehouse`, `WarehouseStock`, nullable `warehouseId` on `StockMovement`, `Sale`, `Purchase`, `SaleReturn`, `PurchaseReturn`, `Inventory`. Code writes `warehouseId` everywhere (default warehouse when none is given) and keeps `WarehouseStock` in sync.
2. **Backfill** (idempotent script, safe to run twice, run in staging first): create the MAIN warehouse per tenant, set `warehouseId` = MAIN on all existing rows, build `WarehouseStock` from `ProductStock`. Verify sums before and after; abort on any mismatch.
3. **Contract** is a later release (make the columns NOT NULL). Write the migration file for it in this PR but do **not** include it in this release; note it in the summary.

### Features
- Purchases (BR) received into a chosen warehouse; sales leave from a chosen warehouse (default: the seller's vehicle if he has one, else MAIN); returns go back to a chosen warehouse.
- Inventory per warehouse.
- **Chargement / déchargement**: `StockTransfer` (number `TR-YYYY-000001`, new `DocType.TR`, type `LOAD` / `UNLOAD` / `TRANSFER`, from, to, lines in any unit converted to base, status `DRAFT` / `VALIDATED` / `CANCELLED`). Validation = one transaction (movements, both stocks, number, audit). Cancel of a validated transfer = reverse transfer, never delete. Idempotent POST.
- Printable bon de chargement (A4/A5) through the existing PDF pipeline.

### API
- CRUD `warehouses`; `POST /stock-transfers` (idempotent), `POST /stock-transfers/:id/validate`, `/cancel`; `GET /stock?warehouseId=`; stock card per product per warehouse.

### Web
- Warehouses page; warehouse selector on BR, sale, return, inventory (hidden when the feature is off).
- Transfer screen built for speed (barcode, Enter to add, quantities in cartons).
- Stock list with one column per warehouse.

### Tests
- Integration: transfer keeps total stock and CUMP equal; sum of WarehouseStock = ProductStock after every operation type; negative stock rules per warehouse; two concurrent sales of the last carton from the same truck → behaves as `negativeStockMode`; a sale and a transfer touching the same products in opposite order do not deadlock; backfill script run twice gives the same result; feature off → single implicit dépôt, all phase 3–7 tests unchanged; tenant isolation.

### Not in this phase
Seller cash closing (16), automatic reorder between warehouses, lots / DLC (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (16 Tournées, visites, commandes).
