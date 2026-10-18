Read AGENTS.md, docs/domain.md (Prices, Clients & credit, Documents, edge cases) and docs/architecture.md (Concurrency) before doing anything.

## Task: Phase 6 — Sales: bon de livraison, facture, retours, fast sale screen

Branch: `phase-06-sales`. Phases 1–5 are merged. This is the most critical phase: take the time to get the transaction right.

### Domain rules to respect
- Documents: **BL** (`BL-YYYY-000001`), **Facture** (`FAC-…`), **Avoir** (`AV-…`). A sale can be a BL, a direct facture, or a facture generated from one or several validated BLs of the same client (the BLs are then marked invoiced; no double stock or ledger effect).
- Statuses: `DRAFT` → `VALIDATED` → `CANCELLED`. Validated documents are never edited; "modifier" = cancel + recreate, both kept in history.
- Line: product, unit, factor, qty, qtyBase, unit price HT (from client price level, overridable with `PRICE_OVERRIDE` permission, logged), discount % optional, TVA rate, designation, cost at sale (CUMP snapshot for margin). All frozen.
- Totals: HT, TVA (only if `assujettiTva`), TTC, rounded per line then summed. Facture also stores the timbre amount (rule implemented in phase 8; store 0 for now with the field ready).
- Payment at sale: `paidAmount` (0 to TTC, or more = change not kept). Mode espèces/chèque/virement. Paid part creates a versement (reuse phase 7 model if present, otherwise create the `Payment` model here and phase 7 extends it).
- Client: optional for cash sales ("client comptoir"); required when any amount goes on credit.
- **Validation, in one transaction**: lock stock rows (ordered by productId) and the client balance row; check `negativeStockMode` and `checkCreditLimit` (BLOCK → refuse with `CREDIT_LIMIT_EXCEEDED`, WARN → succeed with warning; MANAGER+ with `CREDIT_OVERRIDE` can force); assign number; SALE stock movements; ledger entry `+TTC` then `−paidAmount` as PAYMENT; audit log. Endpoint idempotent.
- **Cancel**: reversing SALE_RETURN movements and REVERSAL ledger entries; reason required; MANAGER+.
- **Retour client / avoir** (partial): quantities ≤ sold − already returned, at the frozen sale price; creates SALE_RETURN movements, ledger `−amount`, document AV; option "restock" vs "damaged" (damaged = return then ADJUSTMENT out).

### API
- `POST /sales` (draft), `PUT /sales/:id`, `POST /sales/:id/validate`, `POST /sales/quick` (create + validate in one call for the fast screen; idempotent), `POST /sales/:id/cancel`, `POST /sales/:id/returns`, `POST /invoices/from-bls`, list with filters (type, client, date, status, seller), detail.
- `GET /sales/price-preview?clientId=&productUnitId=` returns the price for that client's level.

### Web
- **Fast sale screen** (Ventes > Nouvelle vente): keyboard first. Barcode/search input always focused, Enter adds line, `+`/`-` change qty, F2 client, F4 payment, F9 validate. Shows client balance and plafond warning live. Must work fully without the mouse.
- Sales list, sale detail with actions (facturer, annuler, retour), BL → facture flow.

### Tests
- Unit: totals with discounts, mixed TVA, non-assujetti tenant, rounding.
- Integration (the important ones): validate sale → stock down, ledger up, numbers sequential; partial payment puts only the remainder on credit; **two concurrent quick sales of the last carton in BLOCK mode → one succeeds, one gets STOCK_INSUFFICIENT**; plafond BLOCK/WARN/override; idempotent replay of `/sales/quick` returns the same sale; cancel restores stock and balance exactly; partial return limits; facture from 2 BLs has no double effect; price change after sale doesn't change the sale; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Versements).
