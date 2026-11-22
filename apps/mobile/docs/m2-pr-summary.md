# Phase 39 · M2 Livreur: PR summary

Branch `phase-39-m2-livreur`, from `main` after M0 (#79) and M1 (#80) were merged.

**No migration**: nothing to run on Neon for this PR (`db:deploy` is not needed).

## What was built

The livreur's four tabs: **Livraisons · Clients · Mon camion · Plus**. They are built on M0's
network layer and `RoleScreens` table, and reuse M1's screens and widgets. One commit per step:

| Step | Commit | What |
|---|---|---|
| 5 | `feat(tournees): GPS check on order delivery (A3)` | **API A3**: optional `geo` on `POST /orders/:id/deliver`, the same GeoCheck as a van sale, with integration tests. The web delivery dialog sends the position too. |
| 1 | `feat(mobile): livreur deliveries list` | Confirmed orders put on him or on the truck he drives. They are grouped by client: today's stops first, in route order, then the other clients by name. Each row shows the number, requested date, line count, TTC and the short-stock lines. The count is shown as a badge on the tab. |
| 2 | `feat(mobile): deliver an order with GPS and the BL` | Order → *Livrer*. Delivered quantity per line (ordered by default, 0 allowed, never more), free units in proportion, the truck's stock per line, packaging returned, amount collected and mode, a confirm step, GPS, `POST /orders/:id/deliver`. The result is the server's BL with *Partager PDF*. |
| 3 | `feat(mobile): livreur clients` | The M1 client list and client screen, read only. *Versement* shows only with a `PAYMENTS_CREATE` grant; *Vendre* and *Commande* never show for a livreur. |
| 4 | `feat(mobile): livreur truck and more menu` | *Mon camion* is the M1 screen on `/me/day`; the cash line reads *Des livraisons*. *Plus* has *Mes livraisons* (each opens its BL), *Mes versements* (only with the grant), then the account block. |
| — | `fix(mobile): keep free units with their unit left to right in Arabic` | Found on real-font screenshots in `ar`: `مجاني: 2 CRT …` was laid out as `CRT … 2 :مجاني`. Fixed in the delivery, and also in M1's basket, BL and order views. |
| — | `docs(mobile): M2 livreur summary` | This file, and the ROADMAP row. |

### API addition A3: GPS on delivery
- **Schema**: `deliverOrderSchema` gets `geo: geoInputSchema.optional()`, the field van sales already have. `DeliverOrderResultDto` gets `geoCheck`.
- **Service**: `SaleWorkflowService.deliverOrderInTx` calls the existing `checkGeoInTx` on the delivery's BL, inside the order's transaction.
  - It applies to field roles only, with FLAG / BLOCK per the tenant, and needs GEO_CHECK.
  - A refusal (`GEO_NOTE_REQUIRED`, `GEO_TOO_FAR`, `GEO_MOCKED`) undoes the whole delivery: no BL, no stock movement, and the order stays CONFIRMED.
  - The check is stored like a van sale's (`refType SALE`, `refId` = the BL), so the web GPS review lists it with no change.
- **Tests** (`apps/api/test/delivery-geo.int-spec.ts`, 6 cases):
  1. At the client: OK, one check on the BL.
  2. Far, FLAG mode: `GEO_NOTE_REQUIRED` and nothing saved. The resend with the **same key** and the note makes **one** BL. A replay returns that BL and writes no second check.
  3. No position: `NO_SIGNAL` asks for a note; the note alone is then enough.
  4. BLOCK mode: `GEO_TOO_FAR`, and nothing saved. A livreur granted `GEO_OVERRIDE` delivers, and the delivery is flagged.
  5. OFF mode writes nothing, and office staff recording a delivery are not checked.
  6. Tenant isolation.
- Plus a shared schema test: the geo fields come all four or none.
- **Web**: `deliver-dialog.tsx` now goes through `useGeoSubmit`, like the sale and versement dialogs. Without this, a livreur delivering from the web in a GEO_CHECK tenant would get `GEO_NOTE_REQUIRED` and no way to type the note. Office roles are not affected (no capture, no check).

### Rules applied
- **Money and quantities are `Decimal`** everywhere. The delivery preview uses the rule of `computeTotals` in `packages/shared` (and of the web dialog): line HT rounded after the remise, TVA per rate. The API recomputes; the phone then shows the BL the API saved.
- **Idempotency-Key**: created when the delivery screen opens. It is kept across a timeout retry, a double tap and the `GEO_NOTE_REQUIRED` resend (same body, same position), and renewed only after a success. Tested in `delivery_test.dart`.
- **Stock comes from the truck**: the API takes the BL from the order's delivery truck (phase 36). The phone shows that truck's stock per line (`availableBase`, in the line's unit). More than the stock is only a warning: the tenant's negative-stock rule decides on the server, and `STOCK_INSUFFICIENT` is shown with the product and what is left.
- **Errors are never swallowed**: `CREDIT_LIMIT_EXCEEDED` (with balance, plafond, after), `STOCK_INSUFFICIENT`, `ORDER_ALREADY_DELIVERED`, `ORDER_DELIVERY_QTY_INVALID`, `GEO_*`. After a network failure the error says a retry is safe.
- **Reused from M1**:
  - `MoneyActionRunner`, `captureGeo` and `IdempotencyKey`;
  - `QtyStepper`, `BasketSummary`, `DocStatusChip`;
  - `SaleResultView` (gets an optional title) and `SaleDetailScreen`;
  - `ClientsScreen` / `clientRoutes` / `ClientDetailScreen` and `TruckScreen`;
  - `AccountScreen` / `MoreItem`, and the payment and packaging blocks of the sale screen.
  - M1's `SaleErrorCard` became `MoneyErrorCard`, shared by the sale and the delivery.
- **No new dependency.**

## How to test

### Local checks (all green on this branch)
- App, in `apps/mobile`: `flutter analyze` (no issues) and `flutter test` (178 tests).
  - The widget tests run at 360 × 640 in `ar` and `fr` with an overflow check: deliveries list (grouped and empty), delivery form, delivered order, livreur clients, my deliveries, truck, Plus menu.
  - The checks caught a 2.7 dp overflow in Arabic on the *Rien / Tout* row, which is now fixed.
- API, on Node 22 against a fresh Postgres 16 on port 5434: `pnpm lint && pnpm typecheck && pnpm test` from the repo root. Results are in **Check results** below.

### Setup for the manual checks
1. On the API: `pnpm install`, then run it locally or deploy a preview. Point `apps/mobile/.env` `API_BASE_URL` at it and `flutter run` on an Android phone.
2. In the demo tenant (DISTRIBUTION), on the web:
   - a livreur user;
   - a delivery truck with a validated chargement of the products you will order;
   - the livreur set as that truck's driver for today (`POST /warehouses/:id/driver`, or the vehicles page);
   - GEO_CHECK in FLAG mode.
3. Use a phone at 360 dp wide. Run each check once in **ar** and once in **fr** (Plus → language).

### M2 acceptance checks
1. **The order reaches the driver**:
   - Take an order on the seller's phone (M1: client → *Commande*) with 2 or more lines, and confirm it.
   - On the web, put it on the delivery truck (order page → livreur / truck).
   - Expected: on the livreur's phone it appears in *Livraisons* (pull to refresh). The tab badge counts it. If the client is on the truck's tournée today, it sits under its stop number.
2. **Partial delivery from the truck's stock**:
   - Open the order. Set one line to 0 with *Rien*, keep the others. Type an amount in *Montant encaissé* and choose *Espèces*.
   - *Valider la livraison* → the confirm shows the line count, the total and the amount → confirm.
   - Expected: the saved BL (`BL-YYYY-…`) shows only the delivered lines, and its total equals the web BL's. On the web:
     - the **truck's** stock went down and the dépôt's did not;
     - the order shows the undelivered quantity.
   - *Partager PDF* opens the French BL.
3. **The cash goes to the right places**:
   - Expected: *Mon camion* → *Ma caisse attendue* → *Des livraisons* includes the cash just collected.
   - The supervisor's team day on the web (`/seller-sessions?date=`, or the clôture screen) shows the same amount for this livreur.
4. **Replay after a timeout**:
   - Start a delivery, switch on airplane mode right after the confirm, wait for the error (it says a retry is safe), switch the network back on and tap *Valider la livraison* again.
   - Expected: one BL only on the web; the phone shows that BL.
5. **The truck's driver changes**:
   - With a confirmed order on the truck, change the truck's driver on the web to another livreur (or seller).
   - Expected: after a refresh the order is gone from the first phone's list and appears on the new driver's phone.
6. **No selling and no price edit**:
   - Expected for the livreur: no *Vendre* tab, no *Vendre* or *Commande* on a client, and no remise or price field on the delivery.
   - *Versement* appears on a client only after the owner grants him `PAYMENTS_CREATE`; *Mes versements* then appears in *Plus*.
7. **GPS (A3)**:
   - Deliver while standing far from the client. Expected: the phone asks for a note, and the delivery goes through with the same key. The web GPS review lists the BL as FAR with the note.
   - With the tenant in BLOCK mode, the same delivery is refused with the translated *trop loin* message.

## Decisions
- **The GeoCheck is stored on the BL** (`refType SALE`), not on the order. There is no new `GeoRefType`, so no migration, and the web review, the report and the verdict flow work as they are. The order links to its BL.
- **The amount collected starts empty**, which means all on credit, as in the M1 sale. Prefilling the TTC would record cash the livreur may not have taken, and his expected cash at the clôture would be wrong. *Tout payé* is one tap, and the confirm step repeats the amount.
- **Free units (UG) are not typed.** The phone shows them in proportion (whole units when the free quantity is whole, half up), and the API's `proportionalFree` decides.
- **Above the truck's stock is a warning, not a block**: `negativeStockMode` belongs to the tenant, and only the server applies it.
- **After a delivery the app reads `GET /sales/:id`** to show the full BL, since the deliver answer only carries its id, number and total. If that read fails, a card with the number, the total and the PDF is shown: the livreur always has his proof.
- **List order**:
  - today's stops first, from `/me/today` (a livreur's tournées are those of the truck he drives), then the other clients by name;
  - inside a client, the oldest requested date first;
  - up to 10 pages of 30 orders are read.
  - Without TOURNEES, or if `/me/today` fails, the list is grouped by client only.
- **"Commande" on a client now needs an order-taking role** (`SELLER` or `SUPERVISOR`, plus TOURNEES). `POST /orders` is for sellers and planners only, but M1 showed the button to anyone with TOURNEES, so a livreur would have hit a 403.
  - The `…/sell`, `…/order` and `…/versement` routes now also redirect back without the right, so a typed path cannot open them.
- ***Mes livraisons* shows no amount.** The order's TTC is what was ordered, not what the BL says after a partial delivery. The BL screen shows the real total.
- **The tab badge** (`TabBadges`) is set by the Livraisons screen when it loads and after each delivery, and reset at logout. The livreur's home is that tab, so the count is there from the start.

## Parked ideas
- ***Commandes à livrer* on the client screen** (the client's confirmed orders, tap → delivery). The Livraisons tab already lists them by client.
- **Proof of delivery**: the client's signature or a photo of the BL. This needs an API field and storage.
- **Navigation to the client** (open Maps at the client's point) from a delivery row.
- **Visits for a livreur**: `POST /visits` is for sellers and planners, so a NO_SALE-style "client absent" is not recorded. It needs an API decision.
- **Packaging factor in `VehicleStockLineDto`** (from M1), to show *Mon camion* as *12 CRT + 5 PCE*.
- **Golden image tests**: the real-font screenshots used for the RTL check were not committed, since font loading in tests is machine-specific.

## Not done here (needs you)
- **Real-phone checks**: I could not run the acceptance checks on a real Android phone at 360 dp. They are written above for you to run in `ar` and `fr`.
- **CI APK**: the mobile job was removed from Actions (PR #82), so `flutter analyze` and `flutter test` were run locally. I did not run `flutter build apk --debug`, to save disk.
- **Roles**: no other road or dépôt role was found in `enums.ts` / `permissions.ts` beyond the four of the prompt.

## Check results (local, 2026-11-22, branch head)
A first full run had 3 Jest 5 s timeouts under machine load: two PDF renders (`printing`, `tournées` › BC PDF) and `stock` › negative mode. All three suites passed alone, and a second full run passed with nothing changed. These load timeouts predate this phase.

| Check | Result |
|---|---|
| `pnpm lint` (Node 22.23.5) | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` (fresh Postgres 16 on port 5434) | ✅ API 74 suites / 994 tests, shared 606, web 59 |
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 178 tests |

## Next sub-phase: M3 Superviseur
- **Tabs**: Équipe · Commandes · Contrôles · Plus.
- **Équipe**: `GET /seller-sessions?date=`, open / close a day with handed cash and the écart, `adjust`, and the truck's driver of the day.
- **Commandes**: assign the team's confirmed orders to a livreur or a delivery truck (`GET /orders/deliverers`, `PATCH /orders/:id/livreur`). The M2 deliveries list then shows them on the driver's phone.
- **Contrôles**: location requests (approve / reject), the team's GPS flags (read only), today's tournée report.
- **Reuse**: the M2 grouping and order rows (`DeliveryTile`) can serve the supervisor's order list; `MoneyErrorCard` serves the clôture errors.
- **No API addition is planned for M3.**
