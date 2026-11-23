# Phase 39 · M6 Cartes: PR summary

Branch `phase-39-m6-maps`, from `main` after the API follow-ups (#88).

**No API change and no migration.** There is nothing to run on Neon. No TypeScript changed, so the root checks are not affected.

**Two new dependencies**, named in the step 1 commit:
- `flutter_map` ^8.3: the OpenStreetMap raster map, with no API key.
- `latlong2` ^0.10: the `LatLng` type flutter_map takes.

There is no clustering package. `geolocator` and `url_launcher` were already in the app.

## What was built

Maps for the seller, the livreur and the supervisor, on top of the phase 35 client map API (`GET /clients/map`) and the phase 17 GPS data. Every map entry needs **GEO_CHECK**: without it no toggle and no map action show, and the lists stay as they were. One commit per step:

| Step | Commit | What |
|---|---|---|
| 1 | `feat(mobile): map core with tiles, client markers, sheet and Naviguer` | **`lib/core/map/`**: `AppMap` (tiles from `MAP_TILE_URL`, the credit from `MAP_TILE_ATTRIBUTION` always shown, User-Agent `com.debvora.app`, *Ma position*, *Recentrer*, rotation off). **`ClientMarker`** with one colour rule. **The client sheet**: name, code · commune, balance (`Decimal`, `AmountText`), *Appeler*, *Naviguer*, *Ouvrir la fiche*. Also *Naviguer* links, `MiniMap`, the *Liste / Carte* toggle, the `/clients/map` repository and the view box. |
| 2 | `feat(mobile): seller day map on Aujourd'hui` | A *Liste / Carte* toggle. **The day:** stops numbered in route order and joined by a line; visited stops are grey with a check. **The *Clients* layer** (off by default) adds the seller's other clients. **Under the map:** *Clients sans position : N* (tap: the list of those stops) and *Zoomez pour voir tous les clients*. |
| 3 | `feat(mobile): livreur deliveries map on Livraisons` | A *Liste / Carte* toggle. **Markers:** one per client with orders to deliver, numbered like the list (a storefront when off the route), with the number of orders on its badge. **The sheet** lists the orders, each with **Livrer** (the existing delivery screen); *Ouvrir la fiche* opens the client under the Livraisons tab. |
| 4 | `feat(mobile): supervisor maps in Contrôles` | **Contrôles → Carte** (the map icon in the app bar): the team's clients with *Vendeur*, *En dette* and *Hors plafond* filters. **Location requests** get a small map of the current and the requested point. **Alertes GPS** get a small map of the client's point and where the operation was made, with the fix's accuracy. |
| 5 | (no commit) | The storekeeper gets no map. A test checks that none of his tabs has one. |
| — | `test(mobile): map sub-pages hide the bottom bar` and `docs(mobile): M6 maps summary` | The #85 bar test for the two new sub-pages, this file, and the ROADMAP row. |

### Rules applied
- **The colour rule** is one pure function, `markerState`, used by every map:
  - visited today → grey with a check;
  - debt over the plafond → red;
  - debt → orange;
  - no debt → green.

  The colours keep at least 4.5:1 with the white number and ring.
- **My position stays on the phone.**
  - The blue dot shows only after a tap on *Ma position*. It goes through the existing permission sheet (loi 18-07 text) and a one-time `GeoService.capture()`.
  - The fix stays in widget state. It is never sent: the map requests carry filters and, above the cap, the rounded view box only. The API strips that box from its logs (`position-privacy.ts`).
- **Above the cap**, the map works like the web:
  - it asks the whole scope first;
  - when `truncated`, it reloads by the visible box (debounced 400 ms, rounded to 0.01°) and shows *Zoomez pour voir tous les clients*;
  - a filter change goes back to the whole scope and refits the camera; a view reload does not move the camera.
- **Gestures:**
  - The full maps are never inside a `RefreshIndicator`, so a drag always pans. Each map has a refresh button instead.
  - The mini maps in the Contrôles cards take no gestures (`IgnorePointer`), so they never fight the list's scroll or its pull to refresh.
  - The app has no swipe between tabs (no `PageView` / `TabBarView`), so there is nothing else for a map to fight.
- **Bottom bar (#85):**
  - The toggles are on tab roots, so the bar stays. The map stops above it, so the bar never covers the credit, the buttons or the notices.
  - `/supervisor/controls/map` and `/livreur/deliveries/client/:id` are sub-pages and hide the bar. The bar test covers both, in ar and fr.
- **The toggle keeps the list.** One `LoadCubit` feeds both views, in an `IndexedStack`. The list keeps its scroll and data, and switching does not reload. The map is built the first time it is shown.
- **RTL:**
  - Map controls use `PositionedDirectional` and the filters `Wrap` from the start.
  - Marker numbers, counts and amounts are LTR (`Money.ltr`, `AmountText`).
- **Strings:** a new `map.*` block (29 keys) in ar, fr and en with identical keys. The parity test is green.

## How to test

### Local checks
- **App** (`apps/mobile`): `flutter analyze` (no issues) and `flutter test` (all green, **479 tests**, 55 new). Results are in **Check results** below.
- **Unit tests:**
  - the *Naviguer* URIs: order, 6 decimals, negative coordinates, iOS without `google.navigation`, the fallback when an app is missing;
  - the colour rule;
  - the view box rounding and clamping;
  - the `/clients/map` decoding and query (never `lat` / `lng`);
  - the livreur join (`deliveryPins`, `clientsToFetch`).
- **Widget tests** at 360 × 640 in `ar` and `fr` with the overflow check, on an in-memory tile provider (no network):
  - **Seller:** the day map (numbers, grey visited, red over limit from the map answer), *sans position* (count and list), the toggle keeping the list's scroll without a reload, the *Clients* layer on/off, the truncated message, the sheet with *Ouvrir la fiche* for a stop and for a layer client, no map without GEO_CHECK.
  - **Livreur:** markers with badges and numbers, the `includeInactive` query, *sans position*, a cut answer reading `GET /clients/:id`, the sheet's orders and *Livrer*, *Ouvrir la fiche*, the toggle, no map without GEO_CHECK.
  - **Supervisor:**
    - the map action with and without GEO_CHECK;
    - the deep link without GEO_CHECK going back to Contrôles;
    - the team map, its 3 filters reaching the API, and the truncated message;
    - the sheet without `DASHBOARD_URL`;
    - both mini maps;
    - a GPS alert without a fix, or with no point at all.
  - **Storekeeper:** no map tab.
- **Existing tests:** the Contrôles cards now hold a 160 dp map, so the second card is below the fold at 640 px. Those tests now scroll to it (`ensureVisible`, `skipOffstage: false`). Every assertion is still there.

### Setup on a real phone
1. **API and app:** run the API locally or use a preview. Set `API_BASE_URL` and `DASHBOARD_URL` in `apps/mobile/assets/config/env.default`, and leave `MAP_TILE_URL` empty for OSM. Then `flutter run` on an Android phone, 360 dp if you can.
2. **Demo tenant:** DISTRIBUTION with **GEO_CHECK** and TOURNEES.
   - A seller with today's tournée of about 6 stops: 2 already visited, 3 with a saved point and 1 without; one of his clients is over his plafond.
   - A livreur with confirmed orders for 3 clients, one of them off today's route.
   - A supervisor of that seller, with a pending location request and a FAR GPS alert from this week.
3. **Languages:** run each check once in **ar** and once in **fr** (Plus → language).

### Seller (Aujourd'hui)
1. **The toggle.** Scroll the list down, then tap **Carte**. Expected:
   - numbered markers in route order, joined by a line;
   - visited stops grey with a check;
   - the over-plafond client red, debtors orange, the others green;
   - *Clients sans position : 1* under the map; a tap lists the stop, and a tap on it opens the client.
2. **Back to the list.** Tap **Liste**. Expected: the list is where you left it.
3. **The sheet.** Tap a marker. Expected: name, commune, the balance as `1 234,50 DA` (in order in Arabic), then *Appeler* (the dialer), *Naviguer* (Google Maps directions to the client) and *Ouvrir la fiche* (the client, with the visit started).
4. **The *Clients* layer.** Turn it on. Expected: his other clients show as small dots, and stops are not doubled. A tap opens the client.
5. **My position.** Tap *Ma position*.
   - First time: the permission sheet; allow it. Expected: a blue dot with its accuracy circle.
   - Check the API logs. Expected: no `lat` / `lng` in any `/clients/map` request.
6. **Gestures.** Pan and pinch the map. Expected: no pull to refresh, no rotation, and the bottom bar always visible with nothing hidden under it.
7. **Without GEO_CHECK.** Turn GEO_CHECK off for the tenant and sign in again. Expected: no toggle; Aujourd'hui is the list as before.

### Livreur (Livraisons)
1. **The toggle.** Tap **Carte**. Expected:
   - one marker per client;
   - the badge shows his number of orders;
   - route clients are numbered like the list, and the off-route client shows a storefront.
2. **The sheet.** Tap a marker. Expected: *Commandes à livrer* with each order (number, TTC) and **Livrer**.
   - Tap **Livrer**. Expected: the delivery screen opens without the bottom bar; after delivering, back on the map that client's badge is down by one.
   - **Ouvrir la fiche** opens the client under the Livraisons tab; Back returns to the map.
3. **Navigation.** Tap *Naviguer*. Expected: Google Maps starts directions. On a phone without Google Maps, any maps app opens at the point (`geo:`).

### Supervisor (Contrôles)
1. **The map action.** Tap the **map icon** in the Contrôles app bar. Expected: *Carte des clients* opens without the bottom bar, showing his team's clients only (check that a client of another team is not there).
2. **Filters.**
   - **Vendeur** → pick a seller: only his clients.
   - **En dette**: only debtors.
   - **Hors plafond**: only red ones.
   - Expected: the camera refits after each change, and *Clients sans position : N* matches the web's client map with the same filters.
3. **The sheet.** Tap a client. Expected: *Ouvrir la fiche* opens the dashboard's client page in the browser. With `DASHBOARD_URL` empty, the button is not there.
4. **Location requests.** Expected: each card has a small map with the current (grey) and the requested (blue) point, a dashed line, and the distance above it. A first position shows the blue point only. Scrolling the list over the map works, and so does the pull to refresh.
5. **Alertes GPS.** Expected:
   - each alert has the client's point (blue) and where the sale was made (orange, with the accuracy circle);
   - an alert recorded without a fix shows the client's point and *Opération sans position*.

### Storekeeper
1. **No map anywhere.** Expected: none on his tabs or in Plus.

## Decisions
- **The supervisor's map is in Contrôles, not Équipe.** Contrôles already holds the GEO_CHECK work (positions and GPS alerts), and Équipe is sessions and cash. It is an app-bar action that opens a sub-page, so the map gets the full height without the bottom bar.
- **The supervisor's *Ouvrir la fiche* opens the dashboard.** He has no client screen in the app. This is M4's rule for links, and the button is hidden without `DASHBOARD_URL`.
- **A seller's stop turns red from the `/clients/map` answer.** `/me/today` has no plafond or `overLimit`. The map asks `/clients/map` once anyway (for the *Clients* layer), so it reuses that answer. If that request fails, an over-limit stop stays orange. I did not add a field to `/me/today` (no API change); it is in Parked ideas.
- **The livreur's points come from `/clients/map`** (`includeInactive=true`: an inactive client may still have an order), then today's stops. `GET /clients/:id` is read only for the clients a **cut** map answer left out, at most 30. A client missing from a complete answer has no point and is counted *sans position*.
- **GPS alerts need no API change.** `GET /geo-checks` already sends `lat` / `lng` and `client.lat` / `client.lng` to the supervisor (`GeoCheckDto`). Only the phone model was missing them.
- **Tiles:**
  - **OpenStreetMap by default**, with the User-Agent `flutter_map (com.debvora.app)`.
  - **OSM tiles are not for heavy production use** ([tile usage policy](https://operations.osmfoundation.org/policies/tiles)). flutter_map prints that reminder in debug builds.
  - **Before a wide rollout**, set MapTiler (or a similar provider) by changing **`MAP_TILE_URL` only**, plus its credit in `MAP_TILE_ATTRIBUTION`. No code change is needed. Both keys are in `apps/mobile/.env.example` and can be overridden with `--dart-define`.
- **The map stops above the floating bar** instead of running under it, so the credit, the buttons and the *sans position* strip are never covered. The strip is literally under the map, as asked.
- **Markers:**
  - 44 dp tap targets. Numbered discs are 30 dp; the *Clients* layer's plain points are 20 dp, so the day's stops stand out.
  - Overlapping markers stack: the stops draw above the layer.
- **Naviguer order:**
  1. `google.navigation:q=lat,lng` (Android: straight to turn-by-turn);
  2. `https://www.google.com/maps/dir/?api=1&destination=lat,lng`;
  3. `geo:lat,lng?q=lat,lng`.

  A snackbar shows if nothing opens.
- **The mini maps are 160 dp and take no gestures.** At 640 px only one Contrôles card fits on screen now. I kept the map size readable instead of shrinking it to fit two cards.

## Parked ideas
- **Live tracking** of sellers and livreurs on the supervisor's map. It needs background location, which loi 18-07 and our "never in the background" promise rule out for now.
- **Route optimisation:** reordering today's stops by distance, then saving the order to the route.
- **Offline tiles**, with M5 offline: downloading the tournée's area in the morning.
- **Clustering** for the supervisor's map of a big team (a package, or server-side grid counts). Today the 2000-point cap and *Zoomez* cover it.
- **API: `overLimit` (or `creditLimit`) on `/me/today` stops**, so a stop is red without the `/clients/map` answer.
- **API: client points in `GET /orders`** (or a `/me/deliveries` view), so the livreur's map needs one request.
- **The switch to MapTiler** (or a self-hosted tile server) before the pilot grows: env only.
- **A legend sheet** on the full maps (the colours are in the sheet and the mini maps' legends today).
- **Golden image tests in Arabic**, as noted since M2.

## Not done here (needs you)
- **Real-phone checks:** written above for each role, in `ar` and `fr`. I could not run them on a real Android phone. The tile servers, the dialer and Google Maps are not reachable from the tests.
- **No APK build.** `flutter build apk` was skipped as asked, to save disk. There is no mobile CI job.

## Check results (local, 2026-11-23, branch head)
| Check | Result |
|---|---|
| `flutter pub get` (apps/mobile) | ✅ |
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 479 tests |
| `pnpm lint && pnpm typecheck && pnpm test` | not run: no TypeScript changed in this branch |
