# Phase 39 · M1 Vendeur: PR summary

Branch `phase-39-m1-vendeur`, based on `phase-39-mobile-field-app` (M0, PR #79, not merged yet).
Merge M0 first; this PR then shows only the M1 commits.

## What was built

The seller's five tabs: **Aujourd'hui · Clients · Vendre · Mon camion · Plus**. They are built
on M0's design system, network layer and `RoleScreens` table. One commit per step:

| Step | Commit | What |
|---|---|---|
| 1 | `feat(mobile): seller today screen` | Truck chip (`code · name`), visited / planned progress, today's stops in route order with each client's balance and a visited mark (`GET /me/today`). Without TOURNEES the tab points to the client list. |
| 2 | `feat(mobile): clients, client detail, location` | Search, *débiteurs*, *près de moi* (GEO_CHECK, position sent in the body), new client. Client screen: balance, plafond and what is left under it, call / WhatsApp, unpaid documents, last sales, 90-day relevé with its PDF, GPS point (saved, or a change request when a supervisor must approve). |
| 3 | `feat(mobile): van sale with basket, prices and GPS` | Product picker (search, camera barcode scan, cartons / pièces, what is left on the truck). Basket priced by `POST /pricing/preview` (price level, promotions, UG). Remise only with PRICE_OVERRIDE, capped at `maxDiscountPct` without DISCOUNT_ABOVE_X. Packaging returned, payment at sale, GPS, `POST /sales/quick`, the server's BL with *Partager PDF*. |
| 4 | `feat(mobile): pre-sale orders` | *Vente directe / Commande* switch: the same basket goes to `POST /orders`, then `/confirm`. Requested date and note. *Mes commandes* with status filters, detail, cancel with a reason. |
| 5 | `feat(mobile): versement with cheque, allocation and receipt` | Espèces / chèque (number, bank, due date) / virement (reference). Optional allocation to unpaid documents, GPS, receipt PDF. *Mes versements*. |
| 6 | `feat(mobile): visits from a stop` | *Terminer la visite*: SALE / ORDER / PAYMENT_ONLY linked to the document just made (or today's, from `/me/today`), or NO_SALE with a reason (OTHER needs a note). GPS, `POST /visits`. |
| 9 | `feat(tournees): seller's own day (A2)` | **API**: `GET /me/day`, with integration tests (below). |
| 7 | `feat(mobile): my truck from /me/day` | Truck, session status, expected cash (from sales / versements; handed and écart once closed), truck stock, today's chargements / déchargements. Read only; quantities only. |
| 8 | `feat(mobile): objectives and the more menu` | *Objectifs* (INCENTIVES, live progress, *dernière mise à jour*), *Mes ventes*, *Mes commandes*, *Mes versements*, then the account block (language, theme, password, help, logout). |
| — | `fix(mobile): keep figures with units left to right in Arabic` | Found on real-font screenshots in `ar`: `96 PCE`, `−5 %` and `2 CRT × 960,00 DA` were reordered, and big bold totals lost their thousands space. Fixed and unit-tested. |

### API addition A2: `GET /me/day`
- **Roles**: SELLER, LIVREUR, and a SUPERVISOR for himself. It sits under TOURNEES, like `/me/today`. OWNER, MANAGER and STOREKEEPER get 403.
- **Payload** (`MeDayDto` in `packages/shared/src/schemas/tournees.ts`):
  - `vehicle`: the truck he drives now;
  - `session`: his session of today;
  - `expected`: computed with `SellerSessionsService.expectedMany` (the clôture's rule, reused, not copied), frozen once the day is closed;
  - `stock`: the clôture's `vehicleStock` (`VehicleStockLineDto`);
  - `transfers`: today's **validated** LOAD / UNLOAD of that truck, with lines in the typed and base units.
- **No costs**: no cost, CUMP, value or price anywhere in the payload.
- `StockTransfersService.validatedForVehicle` is new. `get()` and it share one mapper.
- **Tests** (`apps/api/test/me-day.int-spec.ts`, 7 cases):
  - his truck, stock, chargement and live cash after a cash sale, a cash versement and a cheque (the cheque is left out);
  - drafts, cancelled transfers and other trucks are not listed;
  - a second seller sees only his own truck;
  - a recursive key check finds no `cost / cump / value / price / margin` field;
  - no truck gives `vehicle: null` and empty lists;
  - an open session shows live cash; a closed one shows the frozen figures and the écart;
  - tenant isolation;
  - office roles, the storekeeper and tenants without TOURNEES are refused.
- **No migration**: nothing to run on Neon for this PR (`db:deploy` is not needed).

### Rules applied everywhere
- **Money and quantities are `Decimal`** (the `decimal` package), parsed from the API's strings and sent back as strings. No `double` touches an amount. Totals on the phone are a preview; after a save the app shows the server's document.
- **Idempotency-Key**: created when the form opens and kept for every retry of the same action (timeout, double tap, GEO_NOTE_REQUIRED note); it is renewed only after a success.
  - An order uses one key for the create and another for the confirm. A failed confirm keeps the draft, locks the basket and retries only the confirm.
- **GPS** on sale, versement and visit: one foreground fix (high accuracy, 10 s timeout), sent as all four fields or none. A `GEO_NOTE_REQUIRED` answer asks for the note and resends the same body with the same key and the same position. The permission sheet explains why (loi 18-07, no background location).
- **Errors are never swallowed** on a money action.
  - `CREDIT_LIMIT_EXCEEDED` shows balance, plafond and the amount after the sale.
  - `STOCK_INSUFFICIENT` names the product and what is available.
  - After a timeout the app says a retry is safe.
- **Old cart widgets reused**, rebuilt from `git show 424511a:…/cart/ui/widgets/`:
  - `QtyStepper`;
  - `BasketBar`, from the floating cart bar;
  - `BasketSummary`, from the order summary;
  - `DocStatusChip`, from the order status chip.
- **New dependencies**, each named with its reason in its commit: `geolocator`, `share_plus` and `mobile_scanner`. None is ESM or Node; all are Flutter only.

## How to test

### Local checks (all green on this branch)
- App, in `apps/mobile`: `flutter analyze` (no issues) and `flutter test` (140 tests). The widget tests run the main screens at 360 × 640 in `ar` and `fr` with an overflow check: today, clients, client detail, basket, saved BL, versement, visit, truck, objectives, Plus menu.
- API, on Node 22 against a fresh Postgres on port 5434: `pnpm lint && pnpm typecheck && pnpm test` from the repo root. Results are in **Check results** below.

### Setup for the manual checks
1. Merge or check out this branch. On the API: `pnpm install`, then run the API locally or deploy a preview.
2. In `apps/mobile/.env` set `API_BASE_URL` to that API, then `flutter run` on an Android phone (or `flutter build apk --debug`).
3. On the web, in the demo tenant (DISTRIBUTION):
   - give a seller a truck (`POST /warehouses/:id/driver` or the vehicles page) and validate a chargement of 3 or more products;
   - create a promotion on one of them;
   - put 3 of his clients on a route for today;
   - give one client a plafond and set the tenant's credit mode to **BLOCK**;
   - set GEO_CHECK to FLAG (note required when far).
4. Use a phone at 360 dp wide (or *Display size* set so the width is 360 dp). Run every check below once in **ar** and once in **fr** (Plus → language).

### M1 acceptance checks
1. **Van sale with 3 lines, paid in part**:
   - Aujourd'hui → first stop → *Vendre*. Add product A in **cartons** (scan its carton barcode), product A in **pièces**, and the promotion product (its line shows *Promo : …* and any free line).
   - Type an amount below the total in *Montant encaissé* and choose *Espèces*. Tap *Valider la vente*.
   - Expected: the saved BL shows its `BL-YYYY-…` number. On the web:
     - the BL total equals the phone's TTC;
     - the client balance rose by the unpaid part;
     - the truck's stock dropped (warehouse page, the truck).
   - Tap *Partager PDF*: the French BL PDF opens in the share sheet.
2. **Retry after cutting the network**:
   - Start a sale, switch on airplane mode right after tapping *Valider*, wait for the error (it says a retry is safe), switch the network back on and tap *Valider* again.
   - Expected: one BL only on the web (same number); the phone shows that BL.
3. **Versement by cheque**:
   - Client → *Versement*: amount, *Chèque*, number, bank, due date; optionally tick an unpaid document. Save.
   - Expected: *Partager le reçu* works, and the web client statement shows the versement (and the allocation).
4. **NO_SALE visit**:
   - Aujourd'hui → a stop → *Terminer la visite* → *Pas de vente* → *Autre* + a note (saving without the note is refused on the phone).
   - Expected: the stop shows as visited; the web tournée report counts the visit under NO_SALE / OTHER.
5. **Over the plafond in BLOCK mode**:
   - Sell more than the client's remaining plafond on credit.
   - Expected: refused with the translated *plafond* message and the figures (solde, plafond, après la vente); nothing is created on the web.
6. **Far sale flagged**:
   - Sell to a client whose saved point is far from where you stand. When asked, type the note (it is resent with the same key).
   - Expected: the saved BL says the operation will be reviewed, and the web GPS review lists it.
7. **No deep link into other roles**:
   - The app registers no URL scheme yet (only the launcher intent), so a link from outside cannot reach any path.
   - Inside the app, every navigation goes through the M0 router redirect: a path of another role (`/livreur/deliveries`, `/supervisor/team`…) sends the seller back to his Aujourd'hui. `test/core/router/role_screens_test.dart` covers it (`sessionRedirect`).
   - M1's new routes all sit under `/seller/…`, so the same rule covers them.
   - Nothing to run on the phone for this check until a link scheme is added.
8. **Mon camion**:
   - Expected: the truck, today's chargement (number `TR-…`, time, lines) and the expected cash (espèces from the sales and versements above). No cost or value anywhere.
   - After the web closes the seller's day: *Journée clôturée*, the handed amount and the écart.
9. **Objectifs** (INCENTIVES, with a target on the seller):
   - Expected: progress bars, *Dernière mise à jour à HH:MM*, and pull to refresh updates them.

## Decisions
- **Prices and promotions come from `POST /pricing/preview`**, the same call the web sale screen uses. `GET /sales/price-preview` only gives one unit's list price, without promotions or UG. The preview is display only: the API prices the sale again.
- **PDFs are shared as files** (`share_plus`, bytes from the PDF endpoints): BL, BC, receipt and relevé. Share links (`POST /share-links`) only exist for FACTURE and RELEVE, so they would not cover a BL.
- **Who may give a remise**: the field is shown only with `PRICE_OVERRIDE` (the API counts any remise as a price override). Without `DISCOUNT_ABOVE_X` it is capped at the tenant's `maxDiscountPct`, read from `GET /tenant/settings`. The API checks both again.
- **Order = create then confirm**, two keys. If the confirm fails, the draft stays (visible in *Mes commandes*, where it can be cancelled) and the basket is locked, so the draft on the API never differs from what is confirmed.
- **The visit start time** is when the client screen opens: from a stop of Aujourd'hui, or from the client list (then without a route). A device clock behind the start never sends an end before it.
- **Today opens its clients inside its own tab** (`/seller/today/client/:id`). Pushing the Clients tab's path would jump branches, and the visit result could not return to Aujourd'hui.
- **`/me/day` follows `/me/today`**: it sits under TOURNEES, and the truck comes from `VehiclesService.currentVehicleOf`. On a closed day, `expected` returns the frozen clôture figures, so the phone and the web show the same écart.
- **"Mon camion" shows stock in the base unit.** `VehicleStockLineDto` carries no packaging factor, and adding one was not part of A2.
- **Figures in Arabic**: every quantity with its unit, and every `qty × price`, is one LTR-isolated run (`Qty.withUnit`, `Money.ltr`). Bold amounts use a no-break space for thousands: the bold Almarai weights have no U+202F, so the space vanished.
- **The new-client form asks for the code**, like the web. The API has no code suggestion.

## Parked ideas
- **Chargement form for a seller with `STOCK_TRANSFER`**: the entry is shown disabled in *Mon camion*; the form comes with the magasinier screens (M3b).
- **Assistant item in Plus**: M4.
- **Packaging factor in `VehicleStockLineDto`**, to show the truck's stock as *12 CRT + 5 PCE* like the product picker does. It needs an API field; ask before adding it.
- **Golden image tests**: M1 has widget tests with overflow checks at 360 dp in `ar` and `fr`. The real-font screenshots I used for the RTL check were not committed, since font loading in tests is machine-specific.
- **Statement period picker**: the relevé is fixed to the last 90 days.

## Not done here (needs you)
- **Real-phone checks**: I could not run the acceptance checks on a real Android phone at 360 dp; they are written above for you to run in `ar` and `fr`.
- **CI APK**: the CI APK step is not exercised, since GitHub Actions minutes are used up. I ran `flutter analyze` and `flutter test` locally; I did not run `flutter build apk --debug`, to save disk.
- **Not pushed**: the branch is local only. You asked me not to push.

## Check results (local, 2026-11-22, branch head)
| Check | Result |
|---|---|
| `pnpm lint` (Node 22.23.5) | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` (fresh Postgres 16 on port 5434) | ✅ API 73 suites / 988 tests, shared 605, web 59 |
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 140 tests |

## Next sub-phase: M2 Livreur
- **Tabs**: Livraisons · Clients · Mon camion · Plus.
- **API A3 first** (GPS on delivery): `deliverOrderSchema.geo`, plus the GeoCheck in `orders.service.ts` `deliver`, with tests (far delivery flagged; BLOCK refuses without GEO_OVERRIDE; `GEO_NOTE_REQUIRED` then a resend on the same key makes one BL).
- **Reused from M1**: the delivery form uses `MoneyActionRunner`, `captureGeo`, `QtyStepper` and the BL result view. *Mon camion* is the same `TruckScreen` (already on `/me/day`, open to LIVREUR); its tab path `/livreur/truck` only needs mapping in `tab_routes.dart`. The client screens are reused read-only, with *Versement* only when `PAYMENTS_CREATE` is granted.
