# Phase 39 · M3b Magasinier: PR summary

Branch `phase-39-m3b-magasinier`, from `main` after M3 (#84) and the bottom-bar fix (#85) were merged.

**No API change, no migration.** Nothing to run on Neon for this PR (`db:deploy` is not needed). **No new dependency.**

## What was built

The storekeeper's four tabs: **Chargements · Camions · Inventaire · Plus**. The same chargement screens also open to a seller, livreur or supervisor when the owner granted them STOCK_TRANSFER. Everything uses the existing `/stock-transfers`, `/stock`, `/warehouses` and `/inventories` APIs. One commit per step:

| Step | Commit | What |
|---|---|---|
| 1 | `feat(mobile): storekeeper chargements list` | **Chargements**: the open drafts, then the chargements / déchargements validated on a day (today by default, never a future day), with truck filter chips. The detail screen shows the head (number, from → to, who, when, note, cancel reason) and the lines in their unit plus the base quantity. The tab needs STOCK_TRANSFER. |
| 2 | `feat(mobile): new chargement with draft and validate` | **Nouveau chargement**: truck (`code · name`) and source dépôt (the truck's own dépôt by default). Lines come from the product picker (search, barcode scan, cartons / pièces, the dépôt's stock shown). *Enregistrer* makes a draft (`POST`, then `PUT` while it changes). *Valider* comes after a confirm with the line count and the quantities per unit. `STOCK_INSUFFICIENT` marks its line in red. |
| 3 | `feat(mobile): evening unload from a truck's stock` | **Décharger le reste**: a déchargement truck → its dépôt, pre-filled with everything left on the truck (`GET /stock?warehouseId=<truck>`). Lines are in cartons when the rest is a whole number of them, else in pièces, and stay editable. |
| 4 | `feat(mobile): cancel a transfer with a reason` | *Annuler* a validated transfer (the goods move back) or *Abandonner* a draft, both with a reason of 3 characters or more. The transfer stays, shown *Annulé* with its reason; nothing is deleted. A validated transfer shares its bon as a PDF (`GET /documents/TR/:id/pdf`). |
| 5 | `feat(mobile): trucks and their stock` | **Camions**: every truck in reach with its driver of today, or *Sans chauffeur*. A truck's stock reads like `4 CRT + 5 PCE`. *Charger* and *Décharger le reste* show only with STOCK_TRANSFER. |
| 6 | `feat(mobile): inventory count` | **Inventaire**: the counts (open first) and *Nouveau comptage* on a dépôt. On the count screen, a pick or scan adds to a product, tapping a line sets it, and a line can be removed; *Enregistrer* sends only what changed. *Valider* shows only with STOCK_ADJUST. |
| 7 | `feat(mobile): chargements for granted field users` | With STOCK_TRANSFER and WAREHOUSES: "Mon camion" (seller, livreur) gets *Nouveau chargement* and *Chargements de ce camion*, and the supervisor's Plus gets *Chargements*. Without the grant no entry shows, and `/seller/truck/loads/...`, `/livreur/truck/loads/...` and `/supervisor/more/loads` go back to the parent screen. |
| 8 | `feat(mobile): storekeeper more menu` | **Plus**: *Assistant* (the placeholder until M4, with AI_ASSISTANT), then the account block with language and theme. The bottom-bar tests now include the storekeeper. |
| — | `docs(mobile): M3b magasinier summary` | This file and the ROADMAP row. |

### Rules applied
- **No cost, price or value anywhere** on these screens.
  - The `StockLevel` model does not read `avgCost` or `value` from `GET /stock`.
  - The picker never showed prices, and transfer DTOs carry none.
  - Every new screen's test feeds a cost, a value and prices in its JSON (as for a user allowed to see them), then asserts that no text shows `DA` or any of those figures (`expectNoMoney`).
- **Quantities are `Decimal`** in the product's base unit. Cartons / pièces go through `ProductUnit.toBase` / `fromBase` (`factorToBase`), and the API gets `"5.000"` strings (`Qty.toApi`).
- **Idempotency-Key** on create, validate and cancel (and on opening and validating an inventory), kept across retries. See Decisions for exactly how each key behaves. Tested:
  - a double tap on *Valider* sends one validation;
  - a timeout retry sends the same key;
  - a create retried after a timeout sends the same key and body.
- **Reused**: `MoneyActionRunner` (its retry rule, through M3's `noGeoRunner`), `MoneyErrorCard` (with `stockShort`), `IdempotencyKey`, `QtyStepper`, M1's product picker, `AddProductSheet`, `StockLabel`, `stockText` and `BarcodeScanScreen`, M3's `TruckOption`, `askText`, `LoadCubit`, `sharePdf`. M3's day switcher moved to `core/components/widgets/day_bar.dart`, shared by Équipe and Chargements.
- **Product picker** now takes a `PickTarget`. The sale basket is one target (`SaleBasketPickTarget`, M1's behaviour unchanged, its tests green); a chargement and an inventory count are the others.
- **Sub-pages** (new chargement, transfer detail, truck stock, count, assistant) hide the bottom bar through `MainScreen` (#85). They add no padding for it, and the bottom-bar tests check this for the storekeeper.
- **Strings** are in ar, fr and en with identical keys (the parity test is green). `truck.new_load_soon` is gone.

## How to test

### Local checks
- App, in `apps/mobile`: `flutter analyze` (no issues) and `flutter test` (344 tests). New widget tests run at 360 × 640 in `ar` and `fr`, with the overflow check and the no-money check, for:
  - the chargements list (with drafts and validated transfers, empty, error, and the seller's own list);
  - the new chargement form, picker and add sheet, the confirm, the line marked by `STOCK_INSUFFICIENT`, and the result with its TR number;
  - the déchargement pre-filled from the truck, and the list's choice sheet;
  - the detail of a draft, of a validated transfer (cancel flow) and of a refused cancel;
  - the trucks list and a truck's stock, with and without STOCK_TRANSFER;
  - the inventory list and new count sheet, the count in blind mode, with STOCK_ADJUST, and once validated;
  - the storekeeper's Plus menu.
- Root, on Node 22 against a fresh Postgres 16 on port 5434: `pnpm lint && pnpm typecheck && pnpm test`. Results are in **Check results** below.

### Setup for the manual checks
1. On the API: run it locally or deploy a preview. Point `apps/mobile/.env` `API_BASE_URL` at it and `flutter run` on an Android phone.
2. In the demo tenant (DISTRIBUTION with WAREHOUSES), on the web:
   - a **magasinier** (role STOREKEEPER) working in the main dépôt;
   - a **seller** driving truck `CAM-01`;
   - 5 products with stock in the main dépôt, at least one with a carton unit and a barcode;
   - note the stock of the dépôt and of the truck on the web stock page.
3. Log in as the magasinier on a phone at 360 dp. Run each check once in **ar** and once in **fr** (Plus → language).

### M3b acceptance checks
1. **A chargement of 5 lines moves the stock dépôt → truck**:
   - *Chargements* → *Nouveau chargement* → *Chargement*. The truck is preselected or chosen (`CAM-01 · …`) and the source dépôt is the truck's own.
   - Add 5 products: 2 by search, 1 by barcode scan, 1 in cartons and 1 in pièces. Each shows the dépôt's stock.
   - *Enregistrer*. Expected: "Brouillon enregistré", and on the web a draft transfer with no stock change.
   - *Valider*. Expected: the confirm shows 5 lines and the quantities per unit (e.g. `12 CRT · 30 PCE`), then the result shows `TR-2026-…`.
   - On the web: the dépôt went down and the truck went up by the same base quantities, and the transfer `TR-…` is validated.
2. **The seller sees it at once**: on the seller's phone, *Mon camion* (pull to refresh) lists the chargement with its number and lines, and the truck's stock.
3. **The evening déchargement empties the truck**:
   - *Camions* → `CAM-01` → *Décharger le reste*. Expected: one line per product on the truck, cartons when whole, else pièces. Edit one line if you like, then *Valider*.
   - On the web: the truck is at 0 for those products and the dépôt got them back.
4. **A double tap on Valider makes one transfer**: prepare a chargement, tap *Valider* in the confirm twice quickly. Also try airplane mode right after the confirm, then the network back on and *Valider* again. Expected: one transfer on the web, one `TR-…` number.
5. **Cancel**: open the validated chargement → *Annuler* → a reason. Expected: it shows *Annulé* with the reason, and on the web the goods are back in the dépôt and the transfer is still listed (cancelled), not deleted.
6. **No cost or value anywhere**: give the magasinier VIEW_COST_AND_MARGIN on the web for this check. Go through every tab, the picker, a truck's stock and a count. Expected: no amount in DA and no cost anywhere.
7. **A seller without the grant**: on the seller's phone, *Mon camion* shows no *Nouveau chargement*. A deep link to `/seller/truck/loads/new` (`adb shell am start -d …`) lands back on *Mon camion*.
   - Grant him STOCK_TRANSFER on the web, then log out and in again on his phone. Expected: *Nouveau chargement* and *Chargements de ce camion* show.
   - A supervisor with the grant sees *Plus → Chargements*.
8. **Inventaire**: *Nouveau comptage* on the dépôt, scan 3 products and type their counts, then *Enregistrer*. Expected: no expected quantity, no écart and no *Valider* (blind count).
   - Grant STOCK_ADJUST on the web and log in again. Expected: expected and écart per line and *Valider*. Validate; the web shows the inventory validated and the stock adjusted.

## Decisions
- **Today's list = two reads, merged on the phone.**
  - The API's `from` / `to` filter on `validatedAt`, so a date filter drops the drafts, and the list has no status filter.
  - The phone reads the transfers validated that day (every page), plus the open drafts from the latest 3 pages of 100 without a date filter. Drafts of earlier days stay visible, so none is forgotten.
  - Plain dépôt → dépôt transfers (TRANSFER) are left out on the phone.
- **The create key stays bound to the first body sent with it.**
  - A retry after a timeout resends that exact body (the API replays the draft it made), then a `PUT` brings the lines typed since. So one form makes one draft and never meets `IDEMPOTENCY_KEY_REUSED`.
  - After a refusal (4xx, other than `IDEMPOTENCY_REQUEST_IN_PROGRESS`) the API released the key, so the corrected form goes with it.
- **Valider saves first when needed**, then validates with one key for the form. A `busy` guard drops the second tap, and the server's row lock does the rest.
  - `TRANSFER_NOT_DRAFT` after a lost answer reloads the transfer and shows it validated.
  - The draft `PUT` has no Idempotency-Key: it replaces the whole draft and is not `@Idempotent` on the API, so a retry is harmless.
- **Cancel: one key per (transfer, reason)**, like M3's driver change. A second cancel gets `TRANSFER_NOT_VALIDATED`, so the goods never go back twice.
- **The same product picked twice**: the same unit adds up. Another unit turns the line into the base unit with the sum (2 CRT + 3 PCE = 15 PCE), so nothing is rounded away. The API refuses a product on two lines anyway.
- **The confirm shows totals per entered unit** (`120 CRT · 30 PCE`), never one number adding cartons and kilos.
- **Déchargement pre-fill**: products with a quantity above zero on the truck. The packaging unit is used only when the rest is a whole number of it.
- **Inventaire is a blind count** (your choice). Without STOCK_ADJUST the phone shows no expected quantity, no écart and no dépôt stock in the picker. This is **phone-side only**: `GET /inventories/:id` still returns `expectedQtyBase` to anyone with STOCK_VIEW (see Parked ideas).
- **A pick or scan adds** to a product's count (counting a pile, then loose units); tapping a line sets it. Counts go to the API in the base unit. A line whose units the phone does not know (a product not in the dépôt's stock list) can be removed but not edited.
- **Grant**: any field role with STOCK_TRANSFER **and** the WAREHOUSES module gets the chargement screens. That includes a livreur (your choice), since "Mon camion" is the same screen for sellers and livreurs. The storekeeper's own Chargements tab also needs STOCK_TRANSFER, so an owner who revokes it hides the tab (his home becomes Camions).
- **Truck default dépôt**: `TruckOption` gained an optional `parentId` (`WarehouseDto.parent`). The default source of a chargement is the truck's own dépôt, else the default dépôt. M3's screens ignore the field.

## Parked ideas
- **API: a `status` filter on `GET /stock-transfers`** (and a date filter on `createdAt`), so the phone does not page through recent transfers to find drafts.
- **API: hide `expectedQtyBase` / `diffQtyBase` from `GET /inventories/:id` without STOCK_ADJUST**, so the blind count holds on the server too.
- **Counting a truck** (an inventory on a VEHICLE dépôt): not asked; trucks are emptied every evening.
- **Cancelling an inventory from the phone** (STOCK_ADJUST): the web has it.
- **Plain transfers dépôt → dépôt** (TRANSFER) on the phone.
- **"Retirer du camion" / driver changes from Camions**: the magasinier only reads today's driver; planners change it (M3).
- **Golden image tests in Arabic**, as noted in M2 and M3.

## Not done here (needs you)
- **Real-phone checks**: written above for you to run in `ar` and `fr`. I could not run them on a real Android phone.
- **No APK build** (`flutter build apk` skipped as asked, to save disk); there is no mobile CI job (PR #82).
- **Disk**: to run the checks I removed unused Docker images and build cache (`docker image prune -a`, `docker builder prune -a`, about 5 GB; nothing a container uses, no volume) and pruned the pnpm store (1.3 GB of unreferenced packages). The locally built `erp-saas/api:local`, `erp-saas/web:local`, `erp-saas/postgres:local` and jibli images will rebuild on their next `docker compose build`.

## Check results (local, 2026-11-23, branch head)
| Check | Result |
|---|---|
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 344 tests |
| `pnpm lint` (Node 22.23.5) | ✅ |
| `pnpm typecheck` | ✅ (no TypeScript changed in this branch) |
| `pnpm test` (fresh Postgres 16 on port 5434, `--force`) | shared 41 files ✅, web 13 files ✅, API 70 / 74 suites (972 / 994 tests) in the full run. The 22 failures were all Jest's 5 s timeout, in `vehicles`, `sales-force`, `credit` and `multi-unit`, while the Mac was loaded (disk nearly full). Rerun alone on the same DB, those 4 suites are ✅ 83 / 83. No TypeScript changed in this branch, so CI's run is the reference. |

## Next sub-phase: M4 Assistant IA (all four roles)
- **Entry**: the *Assistant* item already in each role's Plus (a placeholder today), shown only when `GET /assistant/status` says `available: true`, with the provider name under the input.
- **Chat**: `POST /assistant/chat` is SSE over POST. Read it with dio `ResponseType.stream`, split on lines and parse each `data:` event (`conversation`, `text`, `replace`, `tool`, `links`, `done`, `error`). Cancel when the screen closes.
- **Conversations**: list, open, delete, 👍 / 👎 feedback.
- **Links**: map web paths to app routes where a screen exists (client, sale, order, payment), else open `DASHBOARD_URL + href`.
- **Rendering**: Arabic RTL with amounts LTR, and a small markdown subset with no new heavy dependency.
- **Tests**: SSE parser unit tests (split chunks, several events in one chunk, `replace`, `error`, a cut stream) and the cubit states.
