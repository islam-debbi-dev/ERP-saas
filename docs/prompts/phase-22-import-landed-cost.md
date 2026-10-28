Read AGENTS.md, docs/domain.md (Prices, Suppliers) and docs/architecture.md (Money & quantities) before doing anything. Read `apps/api/src/purchases` and the CUMP code in `apps/api/src/stock`.

## Task: Phase 22 — Importateur: dossiers d'importation, devises, coût de revient

Branch: `phase-22-import-landed-cost`. Phases 1–13b and 21 are merged (this phase does not need 14–20; it can run right after 21 if the first paying client is an importer). Feature flag: `IMPORT_COSTS`.

### Goal
An importer buys from China (or elsewhere) in USD/CNY/EUR, pays freight, customs, transitaire, port and transport. The real cost of each product (coût de revient / landed cost) must include all of it, so the CUMP and the margins are true.

### Domain rules to respect
- **Foreign-currency purchases**: a BR (and its supplier) can have `currency` (`DZD` default, `USD`, `EUR`, `CNY`, extendable list in shared) and `exchangeRate` (`Decimal(12,6)`, DZD per 1 unit, entered by the user: the rate of the bank domiciliation). Lines keep the foreign unit price **and** the DZD unit price; DZD is what stock and the supplier ledger use. Money in foreign currency is `Decimal(14,2)` too.
- **Foreign supplier balance** is kept in the supplier's currency (`SupplierLedgerEntry.amountCurrency`, `currency`) next to the DZD amount. No exchange gain/loss accounting (parked); the relevé fournisseur shows both.
- **Dossier d'importation** (`ImportFile`, number `DI-YYYY-000001`, new `DocType.DI`): groups one or more BRs of the same shipment (container), status `OPEN` / `CLOSED` / `CANCELLED`, reference (B/L, container number), arrival date.
  - `ImportCost` lines: type `FRET` / `DOUANE` / `TRANSITAIRE` / `MAGASINAGE` / `TRANSPORT` / `ASSURANCE` / `AUTRE`, amount in DZD (or currency + rate), supplier optional (transitaire), allocation method `VALUE` / `QUANTITY` / `WEIGHT` / `VOLUME` / `MANUAL`. Weight/volume need `Product.weightKg` / `volumeM3` (nullable, refuse the method when missing).
  - Import VAT (TVA à l'importation) is a cost only for non-assujetti tenants; for assujetti tenants it is recoverable and not added to the cost. Use the tenant setting, write the rule in `docs/domain.md`.
- **Supplier debts are posted when they are real**: validating a BR of a dossier posts the supplier ledger as usual (we owe the foreign supplier), and adding a cost line with a supplier (transitaire, transporteur) posts that supplier's ledger. Only the stock waits.
- **When stock enters** (decided): the BRs of an OPEN dossier have **no stock effect** yet (status `IN_TRANSIT`). Closing the dossier computes the landed unit cost per line (FOB × rate + allocated costs, rounding only at storage, remainder of rounding on the largest line) and posts the PURCHASE stock movements at that cost in one transaction (CUMP updated, audit). The goods are sellable only after closing; the UI makes this clear. If a tenant needs to sell before all invoices are in, they close with the known costs and use late costs below.
- **Late costs after closing** (transitaire invoice that arrives later): new movement type `COST_ADJUST` with `qtyBase = 0` and a new `valueDelta` field, which spreads the amount over the quantity of those products still on hand and updates the CUMP. The part for units already sold is shown as "écart de coût" in the margin report; past sales are never changed (rule 9). If no stock is left, the whole amount is an écart.
- Cancelling a closed dossier is not allowed; corrections go through purchase returns, adjustments or COST_ADJUST.

### API
- CRUD import files, attach/detach BRs (OPEN only), add costs, `GET /import-files/:id/preview` (allocation table, nothing written), `POST /import-files/:id/close` (idempotent), `POST /import-files/:id/late-cost` (idempotent).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Dossier screen: BRs, costs, allocation preview table per product (FOB, each cost, landed unit cost, versus the last CUMP), close button.
- Currency and rate fields on BR and supplier forms (hidden when the feature is off).
- Margin report gains the écart de coût column.
- All strings in ar / fr / en; printable fiche de coût de revient (PDF).

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: allocation by each method, rounding remainder, landed cost with currency, VAT rule by regime, COST_ADJUST spread and écart.
- Integration: close posts stock and CUMP exactly once (replay safe); two dossiers closing concurrently on the same products keep the CUMP right (lock order by productId); late cost with partial stock and with zero stock; foreign supplier balance in currency and DZD; feature off → BR behaves as before; tenant isolation.

### Not in this phase
Exchange gain/loss accounting, letters of credit, customs declarations (D10) generation (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase.
