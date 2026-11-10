Read AGENTS.md, docs/ui.md and docs/architecture.md before doing anything. Then read `apps/web/src/components/geo/geo-map.tsx` and `geo-map-lazy.tsx` (the phase 17 Leaflet map), `apps/web/src/components/geo/client-location-card.tsx`, `apps/web/src/components/tournees/route-editor.tsx` and `routes-list.tsx`, `apps/web/src/components/sales/client-picker.tsx`, `apps/api/src/clients/clients.service.ts` (`list`: raw SQL filters + `scope.clientSql`), `apps/api/src/clients/client-location.service.ts`, `apps/api/src/tournees/routes.service.ts` (`setStops`) and `tournee-scope.ts`, `apps/api/src/sales-force/scope.service.ts` (`clientWhere` / `clientSql`), `packages/shared/src/geo.ts` (`haversineM`), `packages/shared/src/schemas/clients.ts`, `geo.ts`, `tournees.ts` and `apps/web/src/components/layout/navigation.ts`.

## Task: Phase 35 — Carte des clients et tournées depuis la carte

Branch: `phase-35-client-map`. Phases 14, 16 and 17 are merged (sales force, tournées, géolocalisation). Production is Vercel + Neon: no VPS, no timers, no background jobs, no PostGIS. This phase **writes no money and no stock**; the only write it adds goes through the existing `PUT /routes/:id/stops`.

The need: the owner or a supervisor wants to see on a map where his clients are, who is near a point (near me, near a client, near the dépôt), and when he builds a tournée he wants to tap clients on the map instead of searching them one by one. A seller on the road wants to see which of **his** clients are around him right now.

### Domain rules
- **Feature**: the map needs `Feature.GEO_CHECK` (clients only get coordinates through phase 17). Picking route stops from the map also needs `Feature.TOURNEES`. No new feature flag. Without `GEO_CHECK` the "Carte" entry and buttons are hidden and the API answers the usual feature error.
- **Who sees which clients**: exactly the phase 14 scope (`scope.clientWhere` / `clientSql`): owner and manager all, supervisor his team's clients, seller and livreur only the clients assigned to them. A client outside the scope never appears as a point, not even without its name.
- **Only live clients with a saved point**: `deletedAt IS NULL` and `lat` / `lng` not null. Inactive clients (`active = false`) are hidden by default and shown greyed with a toggle.
- **The map never moves a client.** It reads `Client.lat/lng`. Setting or correcting a point stays the phase 17 flow (`PATCH /clients/:id/location` for deciders, location request for sellers). From a client's bubble on the map there is a link to the client page where that card lives.
- **Clients without a point** are not lost: the page shows "N clients sans position" with a link to the client list filtered on them (new `hasLocation=false` filter), so the owner knows who still needs a GPS point.
- **Distances** are straight-line (haversine, `packages/shared/src/geo.ts`), shown as `350 m` / `2,4 km`. Never call it a driving distance or time. No routing / directions API (no key, no cost); a "Itinéraire" link opens the phone's maps app on the client point (`https://www.google.com/maps/dir/?api=1&destination=lat,lng`, opens Google Maps or the browser).
- **Position of the user** comes from the browser (`navigator.geolocation`, high accuracy, 10 s timeout). It is used in the browser for "near me" and sent only as query parameters to the nearby route. It is **not stored, not audited, not logged** (strip `lat` / `lng` query params from the pino request log for this route). Refused or unavailable location: the map still works, "Près de moi" shows a short explanation.
- **Tile server**: keep OpenStreetMap tiles as today, but read the URL and attribution from `NEXT_PUBLIC_MAP_TILE_URL` / `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` (defaults = the current OSM values) so a paid or self-hosted tile provider can be switched in without code once usage grows (OSM's tile policy forbids heavy use). Add both to `.env.example` and to `geo-map.tsx` too.

### Schema (one migration, additive only)
- Index `clients_tenant_geo_idx` on `clients ("tenantId", lat, lng) WHERE "deletedAt" IS NULL AND lat IS NOT NULL` (raw SQL in the migration, `@@index` comment in schema.prisma if Prisma cannot express the partial index). Nothing else: no new table, no new column.
- After merge: `pnpm --filter @erp/api db:deploy` on Neon (write it in the PR "How to test" and in the summary).

### API (clients module, read only)
- `GET /clients/map` with the zod `clientMapQuerySchema` in `packages/shared`:
  - filters reused from the client list: `search`, `sectorId`, `assignedSellerId`, `hasDebt`, `overLimit`, plus `includeInactive` (default false) and optional bounding box `minLat,minLng,maxLat,maxLng` (all four or none, validated `-90..90` / `-180..180`, min < max);
  - returns `{ points: ClientMapPointDto[], truncated: boolean, withoutLocation: number }`, a **compact** DTO: `id, code, name, commune, phone, lat, lng, active, balance (string, decimal), overLimit, sectorId, assignedSellerId`. No ledger, no addresses beyond commune;
  - hard cap `MAP_POINTS_MAX = 2000`, ordered by name; `truncated: true` when more matched (the web then asks the user to zoom in or filter). Not cursor-paginated on purpose: the map needs all points of the view at once; the cap keeps it bounded;
  - one raw SQL query in the style of `ClientsService.list` (filters + `scope.clientSql` + `LEFT JOIN client_balances`), no N+1; `withoutLocation` is one `count` with the same filters and `lat IS NULL`.
- `GET /clients/nearby?lat=&lng=&radiusM=&limit=`: `radiusM` 100..50 000 (default 5 000), `limit` 1..100 (default 30). SQL prefilters with a bounding box computed from the radius (uses the new index), then orders by haversine distance in SQL; returns the same point DTO plus `distanceM` (integer). Same scope and same filters as `/clients/map` (so "near me with debt" works). Unit-test the bounding-box helper (`packages/shared/src/geo.ts`: `boundingBox(center, radiusM)`) near the equator, at Algerian latitudes and around ±180.
- `GET /clients` gains `hasLocation=true|false` (additive; the existing filters and the `?filtre=` links of phase 33 keep working).
- Both new routes: `@RequirePermission(Permission.CLIENTS_VIEW)` + `@RequireFeature(Feature.GEO_CHECK)`. They write nothing, so no idempotency key and no audit row; `/clients/map` gets a short `Cache-Control: private, max-age=30`.
- Performance budget: `/clients/map` with 2 000 points under 400 ms on Neon from Vercel (check with `EXPLAIN ANALYZE` on the seed bulked up to 5 000 clients; write the numbers in the summary).

### Route stops from the map (tournées)
- **No new write route.** The map picker edits the same in-memory `stops` array of `route-editor.tsx` and saves through the existing `PUT /routes/:id/stops` (replaces the list, `ROUTE_STOPS_SET` audit, row lock, scope check, max 300). The server already refuses clients outside the planner's scope; keep that test green.
- In the route editor, next to "Ajouter un client", a **"Choisir sur la carte"** button opens a full-screen map sheet (`ResponsiveDialog`, full height on phone):
  - points of the clients visible to the **route's seller** scope by default (filter `assignedSellerId = route.seller.id`, with a toggle "Tous mes clients" for owner / manager / supervisor; a SELLER never plans routes, `PLANNERS` only);
  - tap a point → bubble with name, code, commune, balance, "Ajouter à la tournée" / "Retirer"; points already on the route are drawn as **numbered** markers (their position in the tournée), the others as plain dots; colour is never the only clue (number or check mark + label in the bubble);
  - **lasso / rectangle select** is out of scope; instead a "Ajouter les clients visibles (N)" action adds every visible point not yet on the route, after a confirm that shows N, and refuses above the 300 limit with the message the API would give;
  - a thin dashed polyline joins the stops in their order so the owner sees the path; it is a straight line between points, labelled as such;
  - closing the sheet keeps the picks in the editor (not saved yet); the existing sticky "Enregistrer" and the `beforeunload` guard still apply. Drag-to-reorder stays in the list, not on the map.
- **"Ordonner par proximité"** (optional button in the editor, with confirm): reorders the current stops with a greedy nearest-neighbour from a start point (the dépôt of the route's seller (`Warehouse.lat/lng`, phases 15 and 24) when it has a point, else the first stop). Pure function in `packages/shared/src/geo.ts` (`orderByNearest(start, points)`), unit tested; stops without a point keep their relative order at the end. It only changes the in-memory list; the user still presses "Enregistrer".
- New route creation: after the existing "Nouvelle tournée" dialog creates the route and opens the editor, the editor shows a one-line hint "Choisissez les clients sur la carte" with the map button when the route has no stops yet.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), `ResponsiveDialog`, sticky main action, card lists below `md`. Load the UI skills before building screens and run the audit skill on them at the end.
- **New page `/clients/carte`** ("Carte des clients"), entry in `navigation.ts` under Clients (only with `GEO_CHECK`), and a "Carte" button on the clients list header:
  - map takes the screen height minus the header on phone; filters (search, secteur, vendeur, "Avec dette", "Dépasse le plafond", "Inclure inactifs") in a bottom sheet behind a "Filtres" button with the active count; on `md+` a side panel;
  - markers: `CircleMarker` with Leaflet `preferCanvas` (2 000 points stay smooth on a cheap Android); no new clustering dependency. Colour by state (normal / dette / plafond dépassé / inactif) **plus** a legend and the state in the bubble;
  - bubble: name, code, commune, balance `1 234 567,89 DA`, buttons "Fiche client", "Appeler" (`tel:`), "Itinéraire", and for planners "Ajouter à une tournée…" (pick an existing route of the client's seller → adds the client at the end through the same `PUT /routes/:id/stops` after loading the route; shows a toast with an "Ouvrir la tournée" link);
  - **"Près de moi"** button: asks the browser position, centres the map on it, draws the accuracy circle, and opens a list sheet "Clients proches" from `/clients/nearby` sorted by distance (name, distance, balance, Appeler / Itinéraire). A radius chip row 1 km / 5 km / 10 km / 25 km;
  - "Près de ce client" in a bubble does the same around that client;
  - banner when `truncated`: "Plus de 2 000 clients : zoomez ou filtrez"; the map then sends the current bounds with the next query (debounced 400 ms on `moveend`, TanStack Query key includes the rounded bounds);
  - "N clients sans position →" link to `/clients?hasLocation=false`;
  - the client list page gains the `hasLocation` filter chip (sans position / avec position).
- **Seller's day** (`/tournees/aujourdhui`): a "Carte" toggle that shows today's stops as numbered markers with the same bubble actions, plus "Près de moi" limited to the seller's own clients (the scope does it). Visited stops (phase 16 visits of today) get a check mark.
- Map component: extend the phase 17 `geo-map` folder with a reusable `ClientsMap` (lazy, `ssr: false`, `Refit` / `invalidateSize` on resize as today, RTL safe: Leaflet controls stay physical, the panels around use logical CSS). Do not break `GeoMap` used by the client location card and the flagged operations.
- Strings in `ar`, `fr`, `en` messages files (the key-parity test must stay green). Distances and amounts formatted with the shared formatters.

### Tests
- Unit (shared): `boundingBox`, `orderByNearest` (empty, one point, ties, points without coordinates), distance formatting (`950 m`, `1,2 km`), `clientMapQuerySchema` (bbox all-or-nothing, ranges).
- Integration (API, real DB):
  - `/clients/map` returns only live clients with a point, respects every filter, `withoutLocation` is right, `truncated` flips at the cap (lower the cap through a test constant);
  - scope: seller sees only his assigned clients, supervisor his team's, owner all; a client of another seller never appears, not on the map, not in nearby;
  - `/clients/nearby` orders by distance, respects `radiusM` (a client at 4.9 km is in at 5 km, one at 5.1 km is out), respects filters and scope;
  - `GET /clients?hasLocation=false` / `true`;
  - tenant isolation: tenant A's map and nearby never return tenant B's clients, even with B's coordinates as the centre;
  - feature off (Essentiel edition without `GEO_CHECK`) → both routes refused;
  - route stops picked from the map: `PUT /routes/:id/stops` with a client outside the planner's scope still refused (existing test, keep it), with 300 stops OK, 301 refused.
- Playwright mobile (`e2e/web/mobile.spec.ts`): `/clients/carte`, the filters sheet, the nearby list and the route editor map sheet at 360 and 393 px in `ar` and `fr`, no horizontal overflow, "Près de moi" and "Filtres" reachable without scrolling; mock geolocation with `context.setGeolocation` + `grantPermissions(['geolocation'])`; block the tile host in tests (route to a 1×1 PNG) so CI does not hit OSM. Screenshots in `e2e/artifacts/mobile/`.
- Playwright (`e2e/web/web.spec.ts`): create a tournée → open "Choisir sur la carte" → tap two points → close → the two clients are in the list in tap order → "Enregistrer" → reload shows them; "Ordonner par proximité" changes the order; geolocation denied shows the explanation and the map still loads.

### Not in this phase
Driving distance / time and real road routing (needs a paid routing API or a self-hosted OSRM on the VPS), automatic optimal route planning (TSP) beyond the greedy order, lasso selection on the map, live tracking of sellers on the map (GPS history of users: privacy + needs background jobs), heat maps of sales by zone, drawing sectors as polygons on the map, offline map tiles for the Flutter app (phase 19), geocoding an address into a point (no free reliable geocoder for Algerian addresses). List them under "Parked ideas".

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually (including the `db:deploy` step on Neon) / Decisions / Next phase.
