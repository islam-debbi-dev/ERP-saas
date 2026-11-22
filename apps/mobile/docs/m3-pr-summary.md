# Phase 39 · M3 Superviseur: PR summary

Branch `phase-39-m3-superviseur`, from `main` after M2 (#83) was merged.

**No API change, no migration.** Nothing to run on Neon for this PR (`db:deploy` is not needed).

## What was built

The supervisor's four tabs: **Équipe · Commandes · Contrôles · Plus**. They are built on M0's
`RoleScreens` and network layer, and reuse M1 and M2. One commit per step:

| Step | Commit | What |
|---|---|---|
| 1 | `feat(mobile): supervisor team day and clôture` | **Équipe**: the team of a day (`GET /seller-sessions?date=`). Each member shows his truck, the cash expected from sales / deliveries and from versements, and *Pas ouverte / Ouverte / Clôturée* (with the écart once closed). A day switcher goes back to earlier days, never to a future one. The member screen does *Ouvrir la journée*, *Clôturer* (with the cash handed) and *Corriger la clôture*, and changes today's truck. |
| 2 | `feat(mobile): supervisor assigns confirmed orders` | **Commandes**: the team's confirmed orders, with *À assigner* (counted on the tab badge) and *Assignées*, grouped by client with M2's rows. A sheet puts an order on a truck (delivery trucks first, with their driver) or on a livreur of the team (`PATCH /orders/:id/livreur`). |
| 3 | `feat(mobile): supervisor controls` | **Contrôles**: location requests (*Approuver* / *Refuser* with a reason), the team's GPS flags of the last 7 days (**read only, no verdict button**) and today's tournée report. |
| 4 | `feat(mobile): team objectives` | **Plus → Objectifs de l'équipe**: this month's targets and live progress, grouped by member, read only. |
| 5 | `feat(mobile): supervisor more menu` | **Plus**: *Objectifs de l'équipe*, *Assistant* (a "bientôt disponible" page until M4), then the account block, which already has language and theme. |
| — | `docs(mobile): M3 superviseur summary` | This file and the ROADMAP row. |

### Équipe in detail
- **Clôturer**: you type the cash handed. The écart (handed − expected, the server's rule) is previewed in red when short and green when over. A confirm step repeats expected / handed / écart, then `POST /seller-sessions/:id/close`. The result screen shows the **écart the server saved** and what is left on the truck, with the hint that the magasinier will do the déchargement.
- **Corriger la clôture**: a required reason (3 characters or more) and an optional new count → `POST /seller-sessions/:id/adjust`. The corrections are listed under the day, and the count and écart of the last correction are the ones shown.
- **Changer de camion** (today only): the trucks in reach, his own first, each with its current driver. A confirm warns when another driver loses the truck or when the member's old truck is left without a driver. Then `POST /warehouses/:id/driver`. **`SESSION_OPEN_ON_VEHICLE`** ("faites d'abord la clôture") and **`CASH_AFTER_CLOSING`** are shown as the API sends them, in M1's `MoneyErrorCard`.
- **Sales of the day** on the member screen: `GET /sales?sellerId=&validatedFrom=&validatedTo=&summary=true` gives the count and net TTC of the validated documents. If that read fails, the screen says the figure is unavailable and still works.

### Rules applied
- **Team scope comes from the API only.**
  - Équipe, Commandes, location requests, GPS flags, the report and the objectives all show what the API returns for the supervisor (`tourneeSellerIds` / `teamIds` on the server).
  - The member screen (`/supervisor/team/:sellerId`) looks the id up **in the team list the API returns** for that day. An id outside it (another supervisor's seller, a typed or shared link) shows *Pas dans votre équipe*, and **no request carries that id**. Tested: the fake API records only `GET /seller-sessions`.
  - The router still refuses `/supervisor/...` from a seller or livreur account.
- **Idempotency-Key** on every money POST (open, close, adjust, driver change). It is created when the form or screen opens, kept across a timeout retry and a double tap, and renewed only after a success. For the driver change it is one key per chosen truck: retrying the same truck sends the same key, and choosing another truck is a new action. Tested.
- **Money stays `Decimal`**: `handedCash` is sent as `"15000.00"` (`Money.toApi`) and the écart preview is a `Decimal` subtraction. Coordinates and distances (location requests) are `double`: they are positions, not money.
- **Reused**: `MoneyActionRunner` (no GEO on these calls, only its retry rule), `MoneyErrorCard`, `IdempotencyKey`, `LoadCubit` / `PagedCubit`, M2's `groupDeliveries` / `DeliveryGroupHeader` / `DeliveryTile`, M1's `ExpectedCash` / `TruckStockLine` models, `ObjectiveCard`, `AccountScreen` / `MoreItem`, `askText`. `captureGeo` is not used: none of the supervisor's calls take a position.
- **Modules**:
  - *Équipe* and *Commandes* need TOURNEES. Without it the supervisor lands on *Contrôles*.
  - In *Contrôles*, the positions and the GPS flags need GEO_CHECK, and the report needs TOURNEES.
  - *Objectifs* needs INCENTIVES; *Assistant* needs AI_ASSISTANT.
- **Strings** are in ar, fr and en with identical keys (the parity test is green). The translated error codes now also cover `SESSION_ALREADY_CLOSED`, `SESSION_NOT_CLOSED`, `VEHICLE_ALREADY_ASSIGNED`, `SELLER_NOT_ALLOWED`, `WAREHOUSE_NOT_FOUND`, `WAREHOUSE_INVALID`, `ORDER_NOT_FOUND` and `GEO_REQUEST_NOT_PENDING`.
- **No new dependency.**

## How to test

### Local checks
- App, in `apps/mobile`: `flutter analyze` (no issues) and `flutter test` (233 tests). New widget tests run at 360 × 640 in `ar` and `fr` with the overflow check, for:
  - the team list (and an earlier day);
  - the member day: open, closed, not opened, not in the team;
  - the clôture form and its result;
  - the truck picker with a refusal;
  - the orders, both chips;
  - the assign sheet, with success and with a refusal;
  - the three control sections, and the section list without GEO_CHECK;
  - the team objectives, the Plus menu and the assistant page.
- Root, on Node 22 against a fresh Postgres 16 on port 5434: `pnpm lint && pnpm typecheck && pnpm test`. Results are in **Check results** below.

### Setup for the manual checks
1. On the API: `pnpm install`, then run it locally or deploy a preview. Point `apps/mobile/.env` `API_BASE_URL` at it and `flutter run` on an Android phone.
2. In the demo tenant (DISTRIBUTION), on the web:
   - **two supervisors**, A and B;
   - for A: a seller with a truck and a livreur with a delivery truck (`User.managerId` = A);
   - for B: one seller;
   - GEO_CHECK in FLAG mode;
   - a target for A's seller this month (INCENTIVES).
3. Log in as supervisor A on a phone at 360 dp. Run each check once in **ar** and once in **fr** (Plus → language).

### M3 acceptance checks
1. **Only his team**:
   - *Équipe* lists A's seller and livreur, and not B's seller.
   - On the web, copy B's seller id and open `/supervisor/team/<that id>` on A's phone (a deep link, e.g. `adb shell am start -d …`). Expected: *Pas dans votre équipe*, and no figure.
   - *Commandes* → assign sheet → *Livreurs de l'équipe*: B's seller is not offered.
2. **Clôture with a short count**:
   - The seller makes a van sale paid in cash (M1). On A's phone, open his day → *Ouvrir la journée* if needed → *Clôturer* → type 500 DA less than *Caisse attendue*.
   - Expected: the preview reads *Manque 500,00 DA* in red, and the confirm and result screens show the same écart.
   - On the web clôture screen (`/seller-sessions` for today), the same seller shows the same handed cash and écart.
   - Then *Corriger la clôture* with the right count and a reason: the écart becomes 0 on the phone and on the web.
3. **Replay after a timeout**: *Clôturer*, switch on airplane mode right after the confirm, wait for the error (it says a retry is safe), switch the network back on and tap again. Expected: one clôture only on the web.
4. **Driver change refused while a day is open**:
   - With the seller's day open, *Changer de camion* → another truck. Expected: the translated *faites d'abord la clôture* message, and nothing changes.
   - After the clôture, the same change goes through and the web vehicles page shows the new driver.
5. **The order reaches the driver**:
   - A confirmed order of the team appears in *Commandes → À assigner* (with the badge). Put it on the delivery truck.
   - Expected: it moves to *Assignées* with the truck and its driver. On the livreur's phone (M2) it appears in *Livraisons* after a pull to refresh.
6. **Location request**:
   - The seller asks for a new position for a client (M1, client → position). On A's phone, *Contrôles → Positions* shows it with the distance moved.
   - *Approuver* → confirm. Expected: the client's pin moved on the web map.
   - A second request → *Refuser* with a reason. Expected: the web shows it rejected with the reason.
7. **No GPS verdict**:
   - Make a sale far from the client (FLAG mode, with a note). *Contrôles → Alertes GPS* lists it with *À vérifier* and has no button.
   - On the web, the owner gives the verdict. After a refresh the phone shows *Justifié* / *Non justifié*.
8. **Report and targets**:
   - *Contrôles → Rapport du jour* shows the seller's stops, visits and écart, the same as the web tournée report for today.
   - *Plus → Objectifs de l'équipe* shows his target and progress, the same as on the seller's own phone.

## Decisions
- **Targets progress comes from `GET /me/objectives`, not `GET /sales-targets`.** `SalesTargetDto` carries only the target value, with no achieved and no %. `/me/objectives` gives a supervisor his own targets, his team's and each member's, live, with the same rules as the incentive runs. Agreed in the plan.
- **Deliverers are filtered to the team on the phone.**
  - `GET /orders/deliverers` returns every livreur and seller of the company, so a seller of another supervisor would show. The sheet offers only the deliverers whose id is in the team list from `GET /seller-sessions`, so both lists come from the API.
  - Trucks come from `GET /warehouses?type=VEHICLE`, which the API already limits to his reach.
  - The API does not refuse a supervisor who names an outside livreur in `PATCH /orders/:id/livreur`. See Parked ideas.
- **"Today's sales / versements" on the cards are the cash figures of the clôture** (`expected.fromSales`, `expected.fromVersements`), which `SellerDayDto` carries. The member screen adds the day's validated sales (count, net TTC) through `/sales?summary=true`. No endpoint gives a member's versement total in all modes, so cheques and transfers are not shown; the cards say *espèces seulement*.
- **The truck changes only on today's page.** A driver change takes effect now, so offering it on an earlier day would mislead.
- **The écart is shown with a sign and in words** (*Manque* / *Excédent* / *Caisse juste*) because a minus sign is easy to miss in Arabic. The number shown after a save is always the server's.
- **The clôture form uses one key for its lifetime.** If the supervisor changes the amount after a timeout, the API either replays the first close or answers `IDEMPOTENCY_KEY_REUSED`. The day is never closed twice with two amounts.
- **The assign call has no Idempotency-Key**: `PATCH /orders/:id/livreur` sets a value and is not `@Idempotent` on the API, so a retry is harmless. Approve / reject of a location request are not `@Idempotent` either, and a second decision gets `GEO_REQUEST_NOT_PENDING` (translated); the list then refreshes.
- **The GPS flags list covers the last 7 days**, paged, so the screen stays short. The web review keeps the full history.
- **`OrderSummary` now reads `seller` and `livreur`**, which the API already sends. M2's list ignores them.

## Parked ideas
- **API: limit `GET /orders/deliverers` and `PATCH /orders/:id/livreur` to the supervisor's team** (owner and managers unchanged). Today only the phone hides outside deliverers. The web has the same gap.
- **A member's versements in all modes** (cheques, transfers) on the member screen. `GET /payments` has no `collectedBy` filter for planners.
- **"Retirer du camion"** (a driver with no truck, `userId: null`) from the phone. It was not asked for, and the web has it.
- **The member's tournée of today** (stops, visited or not) on the member screen.
- **Map previews** of location requests (needs a map package or a static map key).
- **Golden image tests in Arabic**, as noted in M2.

## Not done here (needs you)
- **Real-phone checks**: written above for you to run in `ar` and `fr`. I could not run them on a real Android phone.
- **No APK build** (`flutter build apk` skipped as asked, to save disk); there is no mobile CI job (PR #82).

## Check results (local, 2026-11-22, branch head)
| Check | Result |
|---|---|
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 233 tests |
| `pnpm lint` (Node 22.23.5) | ✅ |
| `pnpm typecheck` | ✅ (no TypeScript changed in this branch) |
| `pnpm test` (fresh Postgres 16 on port 5434) | ✅ API 74 suites / 994 tests, shared 606, web 59 (forced, no Turbo cache) |

## Next sub-phase: M3b Magasinier
- **Tabs**: Chargements · Camions · Inventaire · Plus (already in `RoleScreens`; Chargements and Camions need WAREHOUSES, Inventaire needs STOCK_COUNT).
- **Chargement**: a draft `POST /stock-transfers` dépôt → truck, edited with `PUT`, then `POST /stock-transfers/:id/validate`. The Idempotency-Key is kept across retries, and a double tap on *Valider* makes one transfer (`TR-YYYY-…`).
- **Déchargement**: pre-filled from the truck's rest. M3's clôture result already returns `vehicleStock` for this.
- **Camions**: a truck's stock (`GET /stock?warehouseId=`).
- **Inventaire**: `GET/POST /inventories`, `PUT /inventories/:id/lines`, and `validate` only with `STOCK_ADJUST`.
- **No cost or value** on any of his screens.
- **Reuse**: `MoneyActionRunner`, `MoneyErrorCard`, `IdempotencyKey`, `QtyStepper`, M3's `TruckOption` / truck picker.
