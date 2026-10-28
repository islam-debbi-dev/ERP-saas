Read AGENTS.md and docs/domain.md (Sales force & distribution) before doing anything.

## Task: Phase 16 — Tournées, visites, bons de commande, clôture de tournée

Branch: `phase-16-tournees-orders`. Phases 1–15 are merged. Feature flag: `TOURNEES`.

### Domain rules to respect
- **Tournée (route)**: `Route` (tenantId, name, sellerId, weekdays smallint[] with 0 = Sunday, Algeria week) + `RouteStop` (routeId, clientId, position). A client can be on several routes. "Today's tournée" for a seller = routes of his whose weekday is today in `Africa/Algiers`.
- **Visite**: `Visit` append-only (tenantId, sellerId, clientId, routeId?, startedAt, endedAt, outcome `SALE` / `ORDER` / `PAYMENT_ONLY` / `NO_SALE`, reason when NO_SALE: `CLOSED` / `HAS_STOCK` / `NO_MONEY` / `REFUSED` / `OTHER`, note, saleId?, orderId?, paymentId?). A correction is a new visit with `correctsVisitId`, never an update. Idempotent POST (the mobile app replays).
- **Bon de commande (pré-vente)**: `Order` + `OrderLine`, number `BC-YYYY-000001` (new `DocType.BC`), status `DRAFT` / `CONFIRMED` / `DELIVERED` / `CANCELLED`, clientId, sellerId, requested delivery date, warehouseId to deliver from. Lines freeze price, unit, tax rate and designation at **confirmation** (rule 9). An order **does not move stock and does not touch the client ledger**.
  - `POST /orders/:id/deliver` creates the BL from the order in one transaction (normal phase 6 sale path: stock, ledger, number, credit check). Delivered quantities can be lower than ordered (rupture); the difference is kept on the order as `qtyNotDelivered`. One order → at most one BL.
  - Assign a LIVREUR to confirmed orders; a livreur sees only his deliveries.
  - No stock reservation in this phase (parked); the order list shows available stock per line as information.
- **Clôture de tournée**: `SellerSession` (tenantId, sellerId, date, vehicle warehouseId?, status `OPEN` / `CLOSED`, expectedCash, handedCash, ecart, closedBy, closedAt, note).
  - expectedCash = cash part of the seller's sales of the day + cash versements he collected (phase 14 `collectedBy`), computed by the API, never typed.
  - The manager enters handedCash; ecart = handed − expected is stored, shown in red when negative, and audited. Closing is idempotent and final; a correction is an `ADJUST` note on a new row, never an update of a closed session.
  - If the seller has a vehicle, closing shows the vehicle stock and offers a déchargement (phase 15 UNLOAD).
- **Links to earlier optional phases**: if phase 17 is merged, `POST /visits` accepts the `geo` object and writes a GeoCheck (refType `VISIT`) exactly like sales. If phase 18 is merged, add the `VISITS` and `STRIKE_RATE` metrics to the incentive engine (they were left out until visits existed).
- Reports: taux de visite (visited / planned stops), strike rate (visits with sale or order / visits), orders vs delivered, écarts by seller.

### API
- CRUD routes + stops (reorder), `GET /me/today` (seller: today's stops with last visit, balance, last sale), `POST /visits` (idempotent), `POST /orders` (idempotent), `/confirm`, `/deliver` (idempotent), `/cancel`, `POST /seller-sessions/:id/close` (idempotent).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Routes editor (drag to reorder stops), orders list with "deliver" action, livreur view, clôture de caisse vendeur screen, visit report.
- The seller "today" screen works on a phone browser (responsive) until the Flutter app (phase 19).
- All strings in ar / fr / en; printable bon de commande through the PDF pipeline.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Integration: order confirm freezes prices; deliver creates exactly one BL with correct stock and ledger, replay creates nothing new; partial delivery; two concurrent delivers of the same order → one BL; visit replay; expectedCash includes only cash and only this seller and day (Algiers day boundaries); closed session cannot be closed again; livreur and seller scoping; tenant isolation.

### Not in this phase
GPS on visits (17), stock reservation, route optimisation, seller debt ledger for écarts (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (17 Géolocalisation).
