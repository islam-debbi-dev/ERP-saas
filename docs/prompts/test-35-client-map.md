You are a senior QA engineer testing **phase 35 (client map, "près de moi", tournée stops from the map)** of the ERP SaaS in this repo. Your job is to **find and prove** problems, not to fix them. Be skeptical: a seller who sees another seller's clients on the map, or a map that freezes a cheap Android phone, and the grossiste stops trusting the app.

## Task: Test 35 — client map and route picking

Branch: `test/phase-35-client-map`. Phase 35 is merged (PR #62: commits `803ad15` API, `d6f2192` web, `d74e67f` docs). The spec is [`phase-35-client-map.md`](phase-35-client-map.md): every rule in it is something to check. Phases 14, 16, 17 and 24 are what it stands on (sales-force scope, tournées, GPS points, dépôt access).

### Read first (do not skip)
- `AGENTS.md` (§3, §5), `docs/ui.md` (phone checks), the spec above, `e2e/README.md`.
- API: `apps/api/src/clients/client-map.service.ts`, `clients.controller.ts` (`map`, `nearby`), `apps/api/src/common/log-privacy.ts`, `apps/api/src/sales-force/scope.service.ts` (`clientSql`, `sellerDepotPoint`), `apps/api/src/tournees/routes.service.ts` (`get`, `setStops`, today), the migration `20261110140000_clients_geo_index`.
- Shared: `packages/shared/src/geo.ts` (`haversineM`, `boundingBox`, `orderByNearest`, distance format) and `packages/shared/src/schemas/clients.ts` (`clientMapQuerySchema`, `clientNearbyQuerySchema`, `MAP_POINTS_MAX`), `schemas/tournees.ts` (`RouteDto.start`, stop `lat` / `lng`).
- Web: `apps/web/src/components/geo/*` (clients-map, clients-map-screen, nearby-sheet, point-bubble, add-to-route-dialog, map-tiles), `components/tournees/route-map-sheet.tsx`, `today-map.tsx`, `route-editor.tsx`, `lib/client-map.ts`.
- Existing tests, so you do not repeat them: `apps/api/test/client-map.int-spec.ts`, `packages/shared/src/geo.test.ts`, `schemas/clients.test.ts`, `log-privacy.spec.ts`, the phase 35 steps in `e2e/web/web.spec.ts` and `mobile.spec.ts`.
- Use the `/graphify` skill to find any other file instead of grepping the whole repo.

### Ground rules
- **Never touch production.** Against the public Vercel URLs you may only send anonymous `GET` requests (check that `/clients/map` and `/clients/nearby` answer 401 without a token, nothing more). Everything else runs locally on databases you created (`docker compose -f infra/docker-compose.yml up -d db db_test`, `pnpm db:migrate`, `pnpm db:seed`).
- **Do not edit `apps/` or `packages/`.** New scripts, specs and SQL go under `e2e/` (e.g. `e2e/api/map.ts`, `e2e/sql/map-perf.sql`, `e2e/web/map.spec.ts`). A dev dependency goes in `e2e/package.json` only, named in the commit with its reason.
- Never skip, disable or weaken a test. Block the tile host in every browser test (route `tile.openstreetmap.org` and the `NEXT_PUBLIC_MAP_TILE_URL` host to a 1×1 PNG): CI and you must not hit OSM.
- A finding counts only with a proof: exact request / command / click path, expected (with the spec or AGENTS.md rule), actual, the file and line you believe is the cause. Otherwise it goes under "Suspected, not proven".
- Severity: **critical** (a client outside the user's scope or of another tenant shows up anywhere, the user's position is stored or logged, a route save loses or corrupts stops), **high** (500 on valid or hostile input, feature gate bypass, map unusable on a 360 px phone, more than 2 s to show 2 000 points), **medium**, **low**. Each critical / high gets a short fix proposal (what to change, which test would lock it). Do not fix.

### Before you start
Record in the report: commit hash, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, the e2e Playwright projects (counts, time). Then seed test data with a script under `e2e/` (not the app seed): two tenants; in tenant A an owner, a manager, a supervisor with a team of two sellers, a seller outside the team, a livreur; 5 000 clients spread around Alger, Oran and Sétif (some without a point, some archived, some `active = false`, some with debt, some over the plafond, mixed sectors and assigned sellers); dépôts with and without a point; tenant B with clients at **the same coordinates** as tenant A's. Tenant A on edition Distribution, a third tenant on Essentiel (no `GEO_CHECK`), and one Distribution tenant with `GEO_CHECK` revoked but `TOURNEES` granted.

### Part A — API correctness (`e2e/api/map.ts`)
- **Scope**, for each role: the set of ids returned by `/clients/map` and `/clients/nearby` equals, exactly, the set of live clients with a point that `GET /clients` returns for the same user and filters (compare sets, not counts). A seller outside the supervisor's team never appears in the supervisor's map. Livreur: what does he see, and does it match the spec?
- **Tenant isolation**: tenant B's clients never appear for A, even when A centres `nearby` on B's coordinates, sends B's sector / seller ids as filters, or B's client id somewhere in the query.
- **Filters**: `search`, `sectorId`, `assignedSellerId`, `hasDebt`, `overLimit`, `includeInactive`, and their combinations, against a plain SQL truth query you write. `withoutLocation` counts the same filters with no point. `GET /clients?hasLocation=true|false` with the phase 33 `?filtre=` links still working.
- **Cap**: with 5 000 matching clients the map returns 2 000, `truncated: true`, ordered by name; with a bbox that contains 1 999 / 2 000 / 2 001 clients, check the edge.
- **Bounding box and nearby edges**: incomplete box (1 to 3 of 4 params), min ≥ max, out-of-range lat / lng, strings, `NaN`, `Infinity`, exponent notation, very long values: always 400 with a proper `code`, never 500. A box crossing the antimeridian (minLng 179, maxLng -179): what happens, and does the spec say? `radiusM` 99 / 100 / 50 000 / 50 001, `limit` 0 / 1 / 100 / 101. A client at 4 990 m is in at 5 000, one at 5 010 m is out (compute the points with `haversineM`, then assert). Near the poles and at lat 0. `distanceM` is an integer and sorted ascending; ties are stable.
- **Feature gates**: Essentiel tenant → both routes refused with the feature error; the tenant with `TOURNEES` but no `GEO_CHECK` → map refused, **and check that `GET /routes/:id` and `GET /me/today` do not hand out client `lat` / `lng` or the dépôt `start` point there** (the route DTO now carries them; decide from the spec whether that is a leak and prove it either way). Permission `CLIENTS_VIEW` removed from a role → refused.
- **Route stops from the map**: `PUT /routes/:id/stops` with clients picked from the map: order kept, 300 OK, 301 refused, duplicates refused, a client outside the planner's scope refused, an archived client refused, a client without a point accepted (or not: say what the spec says). Two planners saving the same route at the same time (`Promise.all`): the final list is one of the two, never a mix, and both audit rows exist. A SELLER cannot call it.
- **`RouteDto.start`** (`sellerDepotPoint`): seller with one OPERATE dépôt with a point, with two, with only a vehicle, with none and a default dépôt with / without a point. Check it never returns a dépôt of another tenant and never a deleted one.
- **"Ordonner par proximité"** (`orderByNearest`): extra property tests in `e2e/` (random sets of 0 to 300 points, with and without a start, points without coordinates): output is a permutation of the input, stops without a point keep their relative order at the end, the result is deterministic.

### Part B — Privacy of the position
- Run the API with pino at `info` and call `/clients/nearby?lat=36.75&lng=3.06&…` directly and through the web proxy path (`/api/clients/nearby…`, `apps/web/vercel.json`). Grep every log line and the Sentry event payloads (use a local fake DSN / transport) for the coordinates. `log-privacy.ts` matches `^/clients/nearby`: prove whether a prefixed path, a trailing slash, an upper-case path, `%2F`, or `lat` sent twice (`lat=1&lat=2`) slips through.
- The audit log and every table: after a full "près de moi" session, `SELECT` for the coordinates you sent across all text / numeric columns (write the SQL in `e2e/sql/`). Nothing must be stored.
- Write down, as "outside the app", what the Vercel request logs of both projects would record for this URL (read Vercel's docs, do not test on prod), and propose the fix if they keep the query string (e.g. POST body or rounding). Owner decides.
- Web: the position is not put in `localStorage`, the URL, the TanStack Query cache persisted anywhere, or analytics.

### Part C — Performance (Neon-like, local)
- `EXPLAIN (ANALYZE, BUFFERS)` of the map and nearby SQL (capture it with Prisma query logging) on 5 000 and 50 000 clients in one tenant and 20 tenants: is `clients_tenant_geo_idx` used? Times in the report. The spec budget is `/clients/map` with 2 000 points under 400 ms.
- Response size of `/clients/map` with 2 000 points (gzip and not). Count the SQL queries per request (no N+1).
- Web: Playwright with CPU throttling ×4 (CDP `Emulation.setCPUThrottlingRate`) on a 360 px viewport: time from navigation to 2 000 markers drawn, time of a pan / zoom, and memory after 20 pans. Debounce: panning 10 times in 2 s sends at most a few `/clients/map` requests, never one per frame.

### Part D — Web and phone (`e2e/web/map.spec.ts`)
Run at 360 and 393 px in `ar` (RTL) and `fr`, plus 1280 px in `fr`. Mock geolocation with `context.setGeolocation` and `grantPermissions`.
- `/clients/carte`: no horizontal scroll, "Filtres" and "Près de moi" visible without scrolling, filter count badge right, legend present (colour is never the only clue), "N clients sans position →" goes to `/clients?hasLocation=false`, banner when truncated.
- Position **denied**, **timeout** (never resolve), **low accuracy** (5 km): the map still loads and the explanation shows; no endless spinner.
- Bubble: "Fiche client", `tel:` link, "Itinéraire" URL (lat, lng right way round), balance formatted `1 234 567,89 DA`, "Ajouter à une tournée…" adds at the end and the toast link opens the right route.
- Route editor: create a tournée → "Choisir sur la carte" → tap 3 points → numbered markers in tap order → "Retirer" one → close → list shows 2 in order → "Enregistrer" → reload. "Ajouter les clients visibles (N)" with N above the room left (300 limit). Closing without saving then leaving the page triggers the `beforeunload` guard. The map inside the sheet is fully drawn (no grey tiles from a wrong size) after the sheet animation and after rotating the phone.
- `/tournees/aujourdhui`: map toggle, numbered stops, visited ones checked, "Près de moi" shows only the seller's own clients.
- Keyboard and screen reader basics on the sheets (focus trapped, Escape closes, buttons have names). Missing keys: any raw `tournees.*` / `clientMap.*` key shown on screen in ar / fr / en.
- Screenshots of every state in `e2e/artifacts/test-35/`.

### Part E — Upgrade path on Neon (read only)
- The migration is additive and safe on a live table: does `CREATE INDEX` (not `CONCURRENTLY`) lock `clients` writes, and for how long on 50 000 rows locally? Write the number and say whether that matters for the pilot.
- The README / runbook says to run `pnpm --filter @erp/api db:deploy` after merge: confirm the step is there and correct. Do not run it on Neon; tell the owner in the report whether it is still owed.

### The report
`e2e/REPORT-35.md`, in English, same layout as `e2e/REPORT.md`: what was tested, how to rerun (one command per part), baseline, results table, findings (critical and high first, each with proof file in `e2e/artifacts/test-35/`), what holds up well, what you could not test and why. End with **go / no-go to show the map to the pilot sellers** and a **fix plan** (small PRs in order, each with the test that would lock it). Do not open the fix PRs.

### Definition of done
- Parts A to E are in the report, or a part is listed as not done with the reason.
- Every finding reruns with one command.
- `git diff --stat origin/main -- apps packages` is empty.
- The new suites pass or fail only on the findings they prove; `pnpm lint && pnpm typecheck && pnpm test` still pass.
- No request other than an anonymous `GET` was sent to production.
- A PR `test/phase-35-client-map` with: What was tested, How to rerun, Findings (count by severity), Decisions, Not done.
