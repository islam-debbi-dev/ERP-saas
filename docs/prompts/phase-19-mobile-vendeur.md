Read AGENTS.md and docs/architecture.md (Offline) before doing anything.

## Task: Phase 19 — Mobile vendeur (Flutter), offline-first

Branch: `phase-19-mobile-vendeur`. Phases 14–18 are merged. Feature flag: `MOBILE_APP` (and the plan's `mobileSellers` limit from phase 13b: the API refuses a new mobile device session over the limit with `MOBILE_SELLER_LIMIT`).

This phase is big. Run it in **two Claude Code sessions**: Part A, merge, then `/clear` and Part B. Commit after each numbered step.

### Stack (decided in AGENTS.md)
Flutter (Android first), Clean Architecture (data / domain / presentation per feature), BLoC/Cubit, go_router, drift (SQLite) for local data, dio for HTTP, `geolocator` for GPS, flutter intl ARB files ar / fr / en (Arabic default, RTL). Code in `apps/mobile`. Add a CI job: `flutter analyze`, `flutter test`, build an APK artifact. Money uses a Decimal package (`decimal`), never `double`.

**UI**: apply the phone rules of [`docs/ui.md`](../ui.md) to Flutter: 360 dp minimum width, Arabic RTL by default (`Directionality` from the locale), 48 dp touch targets, amounts never wrapped and kept LTR inside Arabic text, big buttons usable with one thumb, main action in a bottom bar, readable in sunlight (contrast ≥ 4.5:1). Load the UI / design skills available in the session before building screens.

### Part A — core, sync, sale
1. **Auth**: login (email or phone), refresh token in secure storage, device session visible in the owner's sessions screen (phase 11), mustChangePassword flow.
2. **Pull sync** (server → phone): API endpoints `GET /sync/{products,prices,clients,routes,stock,objectives}?since=<cursor>` returning changed rows (including soft-deleted, so the phone can remove them) with a cursor based on `updatedAt` + id. Only the seller's scope (phase 14) and his vehicle's stock (phase 15). Store in drift.
3. **Outbox** (phone → server): every write (sale, order, versement, visit, client location) is a local row with a client UUID used as the `Idempotency-Key`, status `PENDING` / `SENT` / `FAILED`. A worker sends them in order when online (connectivity + retry with backoff). A replay never duplicates (the API is already idempotent). Server rejections (`FAILED`) are shown to the seller with the error message and never silently dropped.
4. **Conflicts** (architecture.md): the server is the source of truth for stock; sales are accepted and negative stock is flagged per `negativeStockMode`. Prices on the phone are a preview; the API recomputes and the phone stores the server's document after sync.
5. **Screens**: today's tournée (phase 16) with client list sorted by stop order, client detail (balance, last sales), new sale (barcode scan with the camera, quantities in cartons/units, price level, payment at sale), new order, versement, visit with NO_SALE reason. Offline banner and pending outbox count always visible.

### Part B — field features
6. **GPS** on every sale, versement and visit (phase 17 contract): high accuracy, 10 s timeout, `isMocked`, send capturedAt. Show the note field when needed. Permission screen explaining why (law 18-07 notice). No background location.
7. **Bluetooth printing** of the BL on 58/80 mm thermal printers (ESC/POS), French layout, test page in settings. Keep the A4/A5 PDF share as a fallback (WhatsApp share of the server PDF link from phase 21).
8. **Mes objectifs**: progress from `/me/objectives`, cached offline with "last updated" time.
9. **Clôture**: the seller sees his expected cash for the day (computed by the API when online).
10. Push notifications (FCM) are **parked** unless trivial; do not block the phase on them.

### Tests
- Golden tests of the main screens (tournée, new sale, versement, objectives) at 360 × 640 in `ar` and `fr`.
- Dart unit tests: Cubits (sale form totals, outbox worker states), Decimal totals, unit conversion.
- drift in-memory tests: pull sync applies inserts, updates and deletes; cursor resumes.
- Outbox integration test against the real API test server: send, kill connection mid-request, replay → one sale only; FAILED item visible.
- API integration tests for `/sync/*`: scope (a seller never receives another seller's clients), soft deletes included, tenant isolation, device limit.

### Not in this phase
iOS release, Flutter desktop caisse, push notifications, in-app updates (parked).

### Definition of done
AGENTS.md §10 plus: APK built in CI and installed on a real Android phone; a full day simulated in airplane mode (10 sales, 3 versements, 5 visits) then synced with no duplicate and correct balances. Summary ends with What / How to test manually / Decisions / Next phase (20 Mode distributeur).
