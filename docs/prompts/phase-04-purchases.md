Read AGENTS.md and docs/domain.md (Suppliers, Documents) before doing anything.

## Task: Phase 4 — Suppliers & purchases (bon de réception)

Branch: `phase-04-purchases`. Phases 1–3 are merged.

### Domain rules to respect
- `Supplier`: name, phone, address, RC/NIF/NIS/AI optional, notes, soft delete.
- **Bon de réception (BR)** statuses: `DRAFT` → `VALIDATED` → (`CANCELLED`). Only validation has effects.
- Validation, in one transaction: assign number `BR-YYYY-000001` (DocumentNumberingService), freeze lines (product, unit, factor, qty, qtyBase, unit cost HT, TVA rate, designation), call `StockService.applyMovements` with PURCHASE movements and unit cost per base unit (cost / factor), update CUMP, audit log.
- Optional per-line update of selling prices proposed on the screen (never automatic).
- Cancelling a validated BR creates reversing PURCHASE_RETURN movements (never deletes); refused if it would make stock negative in BLOCK mode.
- **Retour fournisseur** (partial return of a validated BR): own document `RF-YYYY-000001`, PURCHASE_RETURN movements, quantities limited to what was received minus already returned. CUMP does not change on returns.
- Supplier ledger and payments to suppliers are **v1.1**: store `totalHt`, `totalTva`, `totalTtc` and `paidAmount` on the BR now so it can be added later, but do not build supplier accounts.

### API
- CRUD suppliers. `POST /purchases` (draft), `PUT /purchases/:id`, `POST /purchases/:id/validate` (idempotent), `POST /purchases/:id/cancel`, `POST /purchases/:id/returns`, list with filters (supplier, date range, status), detail.
- Totals computed server-side with the money helpers; the web total is display only.

### Web
- Achats list, BR form: supplier select, keyboard-first line entry (barcode or search, unit select, qty, cost), live totals, validate button with confirmation.
- Fournisseurs list and form.

### Tests
- Unit: BR totals HT/TVA/TTC with mixed rates and non-assujetti tenant.
- Integration: validate BR → stock up, CUMP correct, number sequential; validating twice (same idempotency key) → one effect; cancel → stock back, CUMP unchanged; partial return limits; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Clients).
