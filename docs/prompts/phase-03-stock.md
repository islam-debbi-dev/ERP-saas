Read AGENTS.md, docs/domain.md and docs/architecture.md (Concurrency) before doing anything.

## Task: Phase 3 — Stock ledger, levels, adjustments, inventaire, CUMP

Branch: `phase-03-stock`. Phases 1–2 are merged.

### Domain rules to respect
- `StockMovement` is **append-only**: tenantId, productId, qtyBase (signed Decimal(14,3)), type (`OPENING`, `PURCHASE`, `PURCHASE_RETURN`, `SALE`, `SALE_RETURN`, `ADJUSTMENT`, `INVENTORY`), refType, refId, unitCost (for entries), createdBy, createdAt, note.
- `ProductStock` caches `qtyBase` and `avgCost` (CUMP) per product, updated **in the same transaction** as the movement. A reconcile job/endpoint recomputes from movements and reports differences.
- CUMP on every entry: `newAvg = (oldQty*oldAvg + inQty*inCost) / (oldQty + inQty)`; if `oldQty <= 0`, `newAvg = inCost`. Exits do not change CUMP. Write this as a pure function in `packages/shared` with unit tests.
- Negative stock follows `negativeStockMode` (ALLOW / WARN / BLOCK). WARN returns the warning in the response; BLOCK throws `STOCK_INSUFFICIENT` with the available quantity.
- Lock `ProductStock` rows with `SELECT ... FOR UPDATE` ordered by productId inside the transaction. Expose this as `StockService.applyMovements(tx, movements[])`; purchases and sales (phases 4 and 6) must call this, never write movements themselves.
- **Opening stock**: one-time per product (qty + unit cost), type OPENING. A second opening is refused; corrections go through adjustments.
- **Adjustment**: reason required (casse, perte, erreur, autre), permission MANAGER+.
- **Inventaire**: create a count session, enter counted quantities (by barcode scan or list), validate → creates INVENTORY movements for differences only, in one transaction. A validated session is read-only.

### API
- `POST /stock/opening`, `POST /stock/adjustments`, inventaire: `POST /inventories`, `PUT /inventories/:id/lines`, `POST /inventories/:id/validate`, `POST /inventories/:id/cancel`. All money/stock POSTs use the idempotency decorator.
- `GET /stock` (levels with value at CUMP, filter low stock: qty <= product.minStock), `GET /stock/:productId/movements` (cursor pagination, running balance), `GET /stock/reconcile` (OWNER only).
- Audit logs on every write.

### Web
- Stock page: levels table with qty in base unit and in default packaging (e.g. "12 cartons + 5 pièces"), value, low-stock badge and filter.
- Product movement history (fiche de stock) with running balance.
- Adjustment dialog, opening stock dialog, inventaire screen (scan-first, keyboard friendly).

### Tests
- CUMP unit tests including first entry, entry after negative stock, decimal quantities.
- Integration: adjustment updates cache + ledger atomically; BLOCK mode refuses going below zero; **two concurrent exits of the last unit in BLOCK mode → exactly one succeeds**; inventaire validate creates only diff movements; idempotent replay creates nothing; reconcile reports zero differences after the tests; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Purchases).
