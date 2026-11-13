# Test report — phase 35, client map and route picking

**Target:** `ee2df3d` (`origin/main`; phase 35 is PR #62: `803ad15` API, `d6f2192` web, `d74e67f` docs).
**Branch:** `test/phase-35-client-map`. **Date:** 2026-11-12 (measurements), finished 2026-11-13.
**Prompt:** [`docs/prompts/test-35-client-map.md`](../docs/prompts/test-35-client-map.md). **Spec:** [`phase-35-client-map.md`](../docs/prompts/phase-35-client-map.md).
**Rule of the pass:** find and prove, do not fix. Nothing under `apps/` or `packages/` is changed.

## Fix status (2026-11-13, branch `fix/phase-35-map-findings`)

The findings below were proven on `ee2df3d` and the text of this report is left as written. All eighteen
are now closed on the branch `fix/phase-35-map-findings`: fifteen by a fix, three by a decision of the
owner (given on 2026-11-13) that is written down and checked. The suites of this pass were run again on the
final build (same commands, section 2).

| Finding | State | How |
|---|---|---|
| B-1, B-2 | fixed | One scrubber in `@erp/shared` (`position-privacy.ts`) drops `lat` / `lng` and the map's view box from any URL or JSON body, whatever the route or its spelling. Used by the pino serializer and by `beforeSend` / `beforeSendSpan` / `beforeBreadcrumb` of the API, browser and SSR Sentry clients. |
| B-3 | fixed | `POST /clients/nearby` takes the position in its body, and the web uses it: the request line a platform logs is `POST /api/clients/nearby`, nothing more. The `GET` spelling is kept for one release (a browser on the previous build), scrubbed in our log and in Sentry, then to be removed. A support (impersonation) session, read-only by method, cannot call the POST. |
| A-2, A-6 | fixed | Every list `search` refuses control characters; SQLSTATE 22021 is a 400 in the exception filter; `lat` / `lng` are parsed from a decimal string, not `z.coerce.number()`. |
| A-7 | fixed | `PUT /routes/:id/stops` takes `baseClientIds` and answers 409 `ROUTE_STOPS_CHANGED` under its row lock when the route changed; the dialog reads again and retries, the editor tells the planner. |
| D-4 | fixed | `useLeaveGuard`: asks before leaving the editor with unsaved changes by a link or the back button. |
| D-1 | fixed | The map measures what is left of the screen and fills it; title left to the top bar on phones; banner and "sans position" link over the map. |
| D-2, D-5, D-6 | fixed | "Clients proches": error state with "Réessayer", a note when the position is rougher than 100 m, two lines per row. |
| D-3 | fixed | The picker queries by view once truncated (`useClientMapByView`, shared with the map screen). |
| C-1 | fixed | Migration `20261113120000_clients_geo_float_index`: generated `lat_f` / `lng_f` (float8) and a partial index on them; the boxes are written on those columns. **Run it before deploying the API.** `clients_tenant_geo_idx` is to be dropped in a later release. |
| A-5 | fixed | `sellerDepotPoint` falls back to the dépôt principal when the seller's only dépôt has no point. |
| E-1 | fixed | README and runbook ("Migrations on Neon", "Reading a query plan"). |
| A-1 | fixed, owner's choice | New company setting `livreurScope` (Paramètres, "Clients visibles par un livreur"): `ALL_CLIENTS`, the default and what every company had, or `OWN_DELIVERIES`, the clients of the commandes given to him. Applied in `ScopeService`, so list, fiche, map and nearby agree. Only the owner changes it. Migration `20261113130000_livreur_scope`. A STOREKEEPER is unchanged (sees every client). |
| A-3 | decided: allowed | A stop planned for a seller is visible to him on his tournée and his day, even outside his scope; nothing else about that client is. Written in `docs/domain.md`. No code change. |
| A-4 | decided: kept | `GEO_CHECK` gates the screens and the two map routes, not the company's own stored points. Written in `docs/domain.md`; the check of `api/map.ts` now asserts that rule. |

Rerun on the final build:

| Part | Before | After |
|---|---|---|
| A `api/map.ts` (76 checks) | 64 pass, 8 fail | 72 pass, **0 fail** (tenant A is seeded with `livreurScope = OWN_DELIVERIES`) |
| B `api/map-privacy.ts` + browser spec | 26 checks: 12 pass, 8 fail; browser 1 fail | 28 checks: 26 pass, **0 fail**; browser spec passes |
| C `api/map-perf.ts` (18 checks) | 10 pass, 5 fail | 15 pass, **0 fail**: the API's role uses `clients_tenant_geo_f_idx` |
| D `web/map.spec.ts` (45 tests) | 21 pass, 24 fail | **45 pass** |
| Repository | API 64 suites / 846 tests | lint and typecheck green; API 65 suites / 870 tests, shared 35 files, web 12 files. In the last full run two API suites (payroll, reports: 21 tests) hit the 5 s timeout under load; run alone right after, both pass (78 of 78). Node 26 here; CI is 22. |

- C, in numbers (`artifacts/test-35-fix/perf-server.md`): nearby 5 km in the 50 000-client tenant, slowest statement 12.9 → about 7 ms; in the 5 000-client tenant 3.1 → 0.8 ms. The widest search (50 km, 100 rows) is slower through the index, as section C already showed for the owner's plan: HTTP p95 63 → about 100 ms, under the 400 ms budget.
- Checks of the suites changed to follow the product: the lost-update check of `api/map.ts` sends `baseClientIds` and retries like the dialog; the A-4 check asserts the decided rule; the privacy session is the web's POST through the rewrite, with a new check on the request line; the browser specs read the POST body, the distance by test id, and wait for the route list before counting it (it raced the skeleton).
- A false alarm met on the way, fixed in the suite: the six-character probe for a longitude (`3.0201`) matched a span timestamp (`…993.020187`) sent in the same second. Probes no longer match after a digit.
- Seen by eye, not by a test: the banner drawn over the map showed through the "Clients proches" sheet; the map box is now its own stacking context. After-fix screenshots: `artifacts/test-35-fix/`. The files under `artifacts/test-35/` are still the proofs of the original pass.
- Not verified: Sentry's hosted service (a local sink received the payloads), Vercel's real request log, Neon, a real phone, and the back-button guard on iOS Safari.
- Still the owner's to do: check whether `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` were set in production before this fix; choose a tile server before real use (OSM policy; the tile host sees where the map is centred).

## Status (read this first when resuming)

| Part | State | Commit |
|---|---|---|
| 0. Baseline and seed | done | `test(e2e): phase 35 baseline and map seed` |
| A. API correctness | done | `test(e2e): phase 35 map API checks (part A)`, then `test(e2e): phase 35 lost-update check on add-to-route (part A)` |
| B. Privacy of the position | done | `test(e2e): phase 35 position privacy checks (part B)` |
| C. Performance | done | `test(e2e): phase 35 performance measurements (part C)` |
| D. Web and phone | done | `test(e2e): phase 35 web and phone checks (part D)` |
| E. Upgrade path on Neon | done | `test(e2e): phase 35 migration lock check (part E)` |
| Final report, go / no-go, fix plan | done | `docs(e2e): phase 35 test report` |

To resume: read this table and `git log --oneline origin/main..HEAD`, start the stack (section 2), go on
with the first part that is not done. The seeded data stays in the local database `erp_t35`; the
fixture (ids and tokens) is in `e2e/.auth/map-fixture.json`, which git ignores: if it is gone, or the
tokens are older than 12 h, run `pnpm test:map:seed` again (it makes new tenants).

## 1. What was tested

| Part | Suite | What it covers |
|---|---|---|
| A | `e2e/api/map.ts` | `/clients/map`, `/clients/nearby`, `GET /clients?hasLocation=`, `PUT /routes/:id/stops`, `RouteDto.start`: scope per role, tenant isolation, filters, cap, hostile input, radius edges, feature gates, concurrency. |
| A | `e2e/api/map-props.ts` | Property tests of `orderByNearest` and `boundingBox` (`packages/shared/src/geo.ts`). |
| B | `e2e/api/map-privacy.ts`, `e2e/sql/map-privacy.sql` | Its own API (pino at `info` into a file, Sentry to a local sink) and a local copy of the Vercel rewrite: the position in the log, in the Sentry payloads, in every column of the database. |
| C | `e2e/api/map-perf.ts`, `e2e/sql/map-perf-seed.sql` | A second database (`erp_t35_perf`): 20 tenants, 145 000 clients, one tenant with 50 000. The SQL the API really runs, read from the Postgres log, `EXPLAIN (ANALYZE, BUFFERS)` as the API's role and as the owner, statements per request, times, payload. |
| C | `e2e/web/map-perf.spec.ts` | 360 px, CPU slowed ×4 (and ×8): navigation → 2 000 points drawn, pan, zoom, heap after 20 pans, requests for ten quick pans. |
| D | `e2e/web/map.spec.ts` (+ `map-data.ts`, `map-helpers.ts`, `map.playwright.config.ts`) | Nine browser tests in five projects (360 and 393 px in `ar` and `fr`, 1280 px in `fr`): `/clients/carte`, filters, the three bad-position cases, "Près de moi", the bubble and "Ajouter à une tournée…", the route editor's map picker, "Ajouter les clients visibles", the seller's day, raw message keys in three languages. 120 screenshots in `artifacts/test-35/` (named `<project>-<state>.png`). |
| E | `e2e/api/map-index-lock.ts` | The migration's `CREATE INDEX` on a live table: how long client writes wait, on 50 000 and 145 000 rows, with and without `CONCURRENTLY`. Read-only check of the deploy step in the README and the runbook. |
| B | `e2e/web/position-privacy.spec.ts` | The browser after a "Près de moi" session: storage, URL, cookies, third-party requests, browser Sentry, database. |

Everything runs against the **real** built API and the **real** PostgreSQL, on a local database made
for this pass. No mock, no stub. Expected values come from the spec or from SQL / TypeScript written
in `e2e/`, never from the service under test.

## 2. How to rerun

```bash
# 1. databases (once). erp_t35 is the audit database; the dev database `erp` is not touched.
docker compose -f infra/docker-compose.yml up -d db db_test
docker exec erp-saas-db-1 psql -U erp -d erp -c "CREATE ROLE erp_app LOGIN PASSWORD 'erp_app'"   # if missing
docker exec erp-saas-db-1 createdb -U erp erp_t35
(cd apps/api && DATABASE_URL_MIGRATE=postgresql://erp:erp@localhost:5432/erp_t35 pnpm exec prisma migrate deploy)
docker exec -i erp-saas-db-1 psql -U erp -d erp_t35 < apps/api/prisma/app-role.sql

# 2. the audit stack: built API on :3003 (connected as erp_app, so RLS applies), built web on :3005
NEXT_PUBLIC_API_URL=http://localhost:3003 pnpm build
e2e/map-stack.sh api &
e2e/map-stack.sh web &

# 3. the data, then one command per part
cd e2e && pnpm install
export API=http://localhost:3003 WEB=http://localhost:3005 DB=postgresql://erp:erp@localhost:5432/erp_t35
pnpm test:map:seed     # 4 tenants, 5 000 clients in tenant A
pnpm test:map:api      # part A
pnpm test:map:privacy  # part B (starts its own API on :3013; the web must be built with a Sentry DSN, see below)
DB=postgresql://erp:erp@localhost:5432/erp_t35_perf pnpm test:map:perf   # part C (own database, own API on :3023)
pnpm test:map:web      # part D (five projects: 360 and 393 px in ar and fr, 1280 px in fr)
DB=postgresql://erp:erp@localhost:5432/erp_t35_perf pnpm test:map:lock   # part E
```

Part C needs `erp_t35_perf`, made like `erp_t35` (createdb, `prisma migrate deploy`, `app-role.sql`). The
first run seeds it (about a minute) and keeps `e2e/.auth/map-perf-fixture.json`; `T35_CPU=8` reruns the
browser half eight times slower.

Part B, browser side: the browser Sentry SDK is on only when the web is **built** with a DSN, as in
production. Build with `NEXT_PUBLIC_API_URL=http://localhost:3003 NEXT_PUBLIC_SENTRY_DSN=http://t35@localhost:3099/2 pnpm --filter @erp/web build`
and restart `e2e/map-stack.sh web`. The spec runs the sink on :3099 itself. Parts C and D ran on that same build.

`e2e/map-stack.sh` changes only environment variables: the two rate limits are raised (the suites send
thousands of requests from one address) and the access token lives 12 h (the login limiter allows ten
logins a minute). The scripts that write as the database owner refuse any database that is not a local
`erp_t35*` (`assertAuditDb` in `e2e/lib/map-fixture.ts`).

### The seed (`e2e/api/map-seed.ts`)

| Tenant | Edition | Content |
|---|---|---|
| A | Distribution, `sellerScope = ASSIGNED_ONLY` | owner, manager, supervisor with two sellers, a seller outside the team, a livreur; 3 sectors; dépôt principal, "Dépôt Oran" (with a point), "Dépôt Sétif" (without); **5 000 clients** around Alger, Oran and Sétif: 4 800 live, 4 300 live with a point, 4 050 on the map by default, 500 live without a point, 250 inactive, 200 archived; debts, plafonds, negative balances; 12 hostile names (`%`, `_`, `\`, HTML, Arabic); 5 clients on one point. |
| B | Distribution | 300 clients **at the very coordinates** of A's clients, a seller, a sector. |
| C | Essentiel | no `GEO_CHECK`; 5 clients with a point. |
| D | Distribution, `GEO_CHECK` revoked, `TOURNEES` kept | a seller, a dépôt principal with a point, a route with 5 located stops. |

Structure goes through the API; the clients are written in bulk SQL with their ledger row and balance
row together. The draw is seeded (`prng(35)`), so two runs give the same points.

## 3. Baseline (before the pass)

| Command | Result |
|---|---|
| `pnpm lint` | 4/4 tasks pass (41 s) |
| `pnpm typecheck` | 4/4 tasks pass (13 s) |
| `pnpm test` | 4/4 tasks pass (207 s): API 64 suites / 846 tests, shared 34 test files, web 12 test files |
| `pnpm build` | 3/3 tasks pass (24 s) |
| Playwright `desktop` / `mobile` / `mobile-360` | 32 passed, 0 failed (6.1 min): desktop 12, mobile 10, mobile-360 10, against the audit stack |

The repository is green before the pass. The findings below are not caught by the existing tests.

## 4. Results

| Part | Suite | Checks | Pass | Fail | Info |
|---|---|---|---|---|---|
| A | `api/map-props.ts` | 6 | 6 | 0 | 0 |
| A | `api/map.ts` | 76 | 64 | **8** | 4 |
| B | `api/map-privacy.ts` | 26 | 12 | **8** | 6 |
| B | `web/position-privacy.spec.ts` (m393-fr) | 9 assertions | 8 | **1** | 0 |
| C | `api/map-perf.ts` | 18 | 10 | **5** | 3 |
| C | `web/map-perf.spec.ts` (m360-fr) | 7 assertions | 7 | 0 | 0 |
| D | `web/map.spec.ts`, 9 tests × 5 projects | 45 tests | 21 | **24** | 0 |
| E | `api/map-index-lock.ts` | 5 | 3 | 0 | 2 |

The 8 failures of part A are the proofs of findings A-1 (3 checks), A-2, A-4, A-5, A-6 and A-7; nothing else fails. A-3 is proven by a proof file, not by a failing check.
The 9 failures of part B are the proofs of B-1 (6 API checks and the browser assertion) and B-2 (2 checks).
The 5 failures of part C are the proof of C-1.
The 24 failed tests of part D are five of the nine tests: four fail in all five projects (D-2 with D-6, D-3, D-4, D-5) and one in the four phone projects only (D-1). Each fails on soft assertions that are D-1 to D-6 and on nothing else (`artifacts/test-35/web-map.json`); the other four tests pass everywhere.

## 5. Findings

Severity as defined by the prompt. Each proof reruns with the command of its part; the files are in
`e2e/artifacts/test-35/`. **18 findings: 3 critical, 1 high, 7 medium, 6 low, 1 for the owner to decide.**

| # | Severity | Finding | Part |
|---|---|---|---|
| B-1 | **critical** | The user's position is sent to Sentry by the API (traces, errors) and by the browser (breadcrumbs) | B |
| A-1 | **critical** (by the rule; the owner must say which of spec and code is right) | A livreur sees every client of the company on the map and nearby | A |
| A-7 | **critical** (by the rule; planners only, nothing corrupted) | "Ajouter à une tournée…" silently drops a stop another planner just added | A |
| A-2 | **high** | `search` with a NUL byte answers 500 on map, nearby and list | A |
| A-3 | medium | A seller sees a client outside his scope once the owner planned it on his route, now with its point | A |
| B-2 | medium | The log scrub misses `/clients/nearby/` and `/Clients/Nearby` | B |
| C-1 | medium | The new geo index is never used by the API: row-level security and `numeric` | C |
| D-1 | medium | At 360 px the map starts at 59 % of the screen and runs off it | D |
| D-2 | medium | A failed "Clients proches" is shown as "no client in this radius" | D |
| D-3 | medium | Picker with "Tous mes clients" above 2 000: "zoomez" loads nothing | D |
| D-4 | medium | The back button drops unsaved picks without asking | D |
| A-4 | low, decision | Without `GEO_CHECK` the coordinates still come out of the route DTO (and of the older client DTO) | A |
| A-5 | low | `RouteDto.start` null when the seller's only dépôt has no point | A |
| A-6 | low | An empty `lat=&lng=` is read as 0, 0 | A |
| D-5 | low | A position known to ± 5 km is used as if exact | D |
| D-6 | low | 76 px for the client's name in the nearby list at 360 px | D |
| E-1 | low | The README's `db:deploy` step does not say which database it migrates | E |
| B-3 | owner decides | Vercel request logs keep the query string, so the position, in both projects | B |

Two more observations, not findings, are in part B (the tile server sees where the user is; `/clients/map` logs its view box).

### Suspected, not proven

- A STOREKEEPER gets the same whole-company map as the livreur (same line of `ScopeService`, same `VIEW_ALL` permissions): not run.
- One client saved with a far-off point (latitude and longitude swapped, or 0, 0) makes `/clients/carte` open zoomed out on the whole world, because the first view fits every point. Seen by accident when my own edge-case clients (pole, antimeridian) were still live in tenant A; I did not write a check for it.
- The browser Sentry SDK also traces `fetch` calls (`tracesSampleRate: 0.1`): the nearby URL is probably in those spans too. Only the breadcrumb was caught in the sink (B-1).
- During one early run of the browser suite, a seller's session showed the owner's landing page after several worker restarts under the login limiter. It did not happen again in three full runs and I could not reproduce it by hand; noted so that it is not forgotten, not counted.

### Part A

#### A-1 — A livreur sees every client of the company on the map and in "Clients proches" (critical by the prompt's rule)

- **Rule:** spec, "Who sees which clients": *"seller and livreur only the clients assigned to them. A client outside the scope never appears as a point, not even without its name."*
- **Request:** as tenant A's livreur, `GET /clients/map?includeInactive=true` (three boxes), `GET /clients/nearby?lat=36.7538&lng=3.0588&radiusM=50000&limit=100`.
- **Expected:** the clients assigned to him: none (a livreur is not a selling role, so no client can be assigned to him).
- **Actual:** 4 319 points, the whole company with name, phone and balance; nearby 100 of 100 outside his scope; `withoutLocation` 500 instead of 0.
- **Proof:** `pnpm test:map:api`, the three failing checks of area A1; `artifacts/test-35/scope-livreur.json`.
- **Cause:** `apps/api/src/sales-force/scope.service.ts:75`: every role but SELLER and SUPERVISOR gets `clientSellerIds: null`. `ClientMapService` (`client-map.service.ts:139`) applies that scope as is. `LIVREUR` has `CLIENTS_VIEW` through `VIEW_ALL` (`packages/shared/src/permissions.ts:289`).
- **To be fair:** the map shows a livreur exactly what `GET /clients` has shown him since phase 14 (the check "map = list" passes for him). The code is consistent with itself and with the comment of `ScopeService`; it is the phase 35 spec that is stricter. So this is either a bug of phase 35 or a wrong sentence in its spec: **the owner decides**, but until he does, a livreur with a phone has the full client map of the company, with debts.
- **Suspected, same line, not proven here:** a STOREKEEPER (`VIEW_ALL` too) gets the same.
- **Fix proposal:** decide the livreur rule in `ScopeService.of` (not in the map service, so the list and the map stay equal): the clients of the orders assigned to him (`orders.livreurId`), or no client screens at all (drop `CLIENTS_VIEW` from the role default and hide "Carte"). Lock it with an integration test in `client-map.int-spec.ts`: "a livreur's map and nearby hold only the clients of his deliveries", plus the `map = list` set comparison of `e2e/api/map.ts`.

#### A-2 — A NUL byte in `search` answers 500 on the map, the nearby list and the client list (high)

- **Rule:** AGENTS.md §4 "Every input validated"; prompt: "always 400 with a proper `code`, never 500".
- **Request:** `GET /clients/map?search=%00`, `GET /clients/map?search=abc%00def`, `GET /clients/nearby?lat=36.75&lng=3.06&search=%00`, and the older `GET /clients?search=%00`, as any logged-in user with `CLIENTS_VIEW`.
- **Expected:** 400 `VALIDATION_FAILED`.
- **Actual:** 500 `INTERNAL_ERROR`; the API logs `Raw query failed. Code: 22021. invalid byte sequence for encoding "UTF8": 0x00` at level error (so it pages Sentry on every call).
- **Proof:** `pnpm test:map:api`, check "85 hostile requests: none answers 500"; table in `artifacts/test-35/hostile-inputs.md`.
- **Cause:** `packages/shared/src/schemas/clients.ts:59` accepts any string; `client-map.service.ts:150` and `clients.service.ts:125` send it to Postgres, which refuses `\0` in text; `all-exceptions.filter.ts:77` only translates `P2002`.
- **Fix proposal:** refuse control characters in the shared `search` field (one `refine` in `clientListQuerySchema.shape.search`, reused by the map schemas), and as a net map Postgres `22021` to 400 in the exception filter. Tests: a case in `schemas/clients.test.ts`, and one line per route in `client-map.int-spec.ts` (`search=\0` → 400).

#### A-3 — A seller sees a client outside his scope once it is planned on his route, now with its GPS point (medium; critical by the letter of the rule, see below)

- **Rule:** spec: "A client outside the scope never appears as a point". Prompt: critical = "a client outside the user's scope … shows up anywhere".
- **Setup:** `sellerScope = ASSIGNED_ONLY`. The owner puts `T35-00036`, assigned to the seller outside the team, on a route of seller1 (`PUT /routes/:id/stops`, accepted: the check is the **planner's** scope).
- **Actual, as seller1:** `GET /clients/map?search=T35-00036` → 0 points and `GET /clients/:id` → 404 (hidden, as the scope says), but `GET /routes/:id` returns it with name, phone, `lat`, `lng`, and `GET /me/today` returns it with name, phone, address, point and balance `1500.00`. The "Carte" toggle of `/tournees/aujourdhui` draws it as a numbered marker.
- **Proof:** `artifacts/test-35/seller-sees-planned-client-outside-scope.json` (written by `pnpm test:map:api`, area A8).
- **Cause:** `routes.service.ts:84-124` (`get`) and `:247-290` (`today`) read the stops' clients without `scope.clientWhere`.
- **Why medium and not critical:** showing a seller the stops his manager planned for him is the point of a tournée (phase 16), and the name / phone / balance were already there before phase 35; phase 35 adds the point. It is a planning decision of the owner, not a way for a seller to reach other clients by himself. But it contradicts the sentence of the spec, so it needs a written decision: either "a planned stop is visible to the route's seller" (then say it in `docs/domain.md`), or `setStops` must refuse a client that is not assigned to the route's seller.
- **Fix proposal (if the second):** in `setStops`, check the clients against the **route's seller** scope when the tenant is `ASSIGNED_ONLY`; test: "owner plans a client of another seller → `VALIDATION_FAILED`".

#### A-4 — Without `GEO_CHECK`, the coordinates still come out of the route DTO (low, decision)

- **Question of the prompt:** does `GET /routes/:id` / `GET /me/today` hand out client `lat` / `lng` and the dépôt `start` point in a tenant with `TOURNEES` but no `GEO_CHECK`?
- **Answer, proven:** yes. In tenant D, `/clients/map` and `/clients/nearby` answer 403 `FEATURE_NOT_IN_PLAN`, and `GET /routes/:id` returns 5 stops with `lat` / `lng` and `start: {36.7701, 3.0552}`; `GET /me/today` returns the 5 points too. `artifacts/test-35/geo-check-off-coordinates.json`.
- **Is it a leak?** Not a new one, and not of someone else's data: in the same tenant `GET /clients` and `GET /clients/:id` already return `location` (phase 17 DTO) and `GET /warehouses` the dépôt's point. `GEO_CHECK` gates the screens and the two new routes, not the stored coordinates; they are the tenant's own data, read inside its own scope. What it means in business terms: a company without the module can still rebuild its map from the API.
- **Cause:** `routes.service.ts:99-100, 119-123, 265-287` select `lat` / `lng` whatever the features.
- **If the owner wants a hard gate:** null `lat` / `lng` / `start` / `location` in the three DTOs when the tenant lacks `GEO_CHECK`; test: the failing check "without GEO_CHECK the route DTO carries no coordinates" of area A7 turns green.

#### A-5 — `RouteDto.start` is null when the seller's only dépôt has no point, although the dépôt principal has one (low)

- **Rule:** `scope.service.ts:146`: "the one dépôt he operates in when it has a point, else the dépôt principal when it has one, else null".
- **Setup:** a seller with OPERATE on "Dépôt Sétif (sans point)" only; the dépôt principal has a point.
- **Expected:** `start` = the dépôt principal's point. **Actual:** `start: null`.
- **Proof:** `pnpm test:map:api`, area A9, check "one OPERATE dépôt WITHOUT a point…".
- **Cause:** `scope.service.ts:166-172`: `own ?? default` keeps the own dépôt as soon as it exists, with or without coordinates.
- **Effect:** "Ordonner par proximité" starts from the first stop instead of the dépôt for those sellers. No data is wrong.

#### A-6 — `z.coerce.number()` reads an empty value as 0: `lat=&lng=` is "near 0°N 0°E" (low)

- **Request:** `GET /clients/nearby?lat=&lng=` → 200 `[]` (expected 400); `GET /clients/map?minLat=&minLng=2&maxLat=37&maxLng=4` → 200 with `minLat` read as 0; a space and `0x24` are numbers too.
- **Proof:** `pnpm test:map:api`, check "an empty `lat=&lng=` is not read as the position 0, 0", and the `no-500 | 200` lines of `artifacts/test-35/hostile-inputs.md`.
- **Cause:** `packages/shared/src/schemas/clients.ts:105-106` (`Number('') === 0`).
- **Effect:** a web bug that sends an empty position gets an empty list instead of an error. Harmless today, wrong by contract.

#### A-7 — "Ajouter à une tournée…" drops a stop another planner has just added, and tells both it worked (critical by the prompt's rule)

- **Rule:** prompt: critical = "a route save loses or corrupts stops".
- **Path:** the owner and the manager each open "Ajouter à une tournée…" on the map for the same tournée (3 stops) and each pick a different client. What the dialog does (`apps/web/src/components/geo/add-to-route-dialog.tsx:49-60`) is `GET /routes/:id`, then `PUT /routes/:id/stops` with that list plus the client. No race is needed, only that the second dialog read the route before the first one saved.
- **Expected:** 5 stops, or the second save refused because its list is stale.
- **Actual:** both `PUT` answer 200, both users get the toast "… ajouté à « … »", and the route has **4 stops: the owner's client is gone**. The same happens to a planner who has the route editor open while someone adds a stop from the map, then presses "Enregistrer".
- **Proof:** `pnpm test:map:api`, area A8, check "Ajouter à une tournée… by two planners…"; `artifacts/test-35/add-to-route-lost-update.json`.
- **Cause:** `PUT /routes/:id/stops` replaces the whole list and has no way to say "from which list" (`routes.service.ts:191-244`, `setRouteStopsSchema`): the row lock makes two saves happen one after the other, it cannot make the second one know about the first. That was already true in phase 16 for two open editors; phase 35 adds a one-tap "append" on top of a "replace" route, which is where a lost update stops being rare.
- **What limits it:** nothing is corrupted (the list is always one somebody sent, the 25-round race of the same area proves it) and the audit log has both lists (`ROUTE_STOPS_SET`, before / after), so the lost stop can be found again. But nobody is told to look.
- **Fix proposal** (no new write route, as the spec wants): `setRouteStopsSchema` gets an optional `baseClientIds` (or the route gets a `version`, as clients have); the service compares it under the row lock it already takes and answers 409 `CONFLICT` when the route changed; the dialog reads again and retries once, the editor says "la tournée a changé, rechargez". Test: this check, plus an integration test "two saves from the same read: the second is refused".

#### Answers the prompt asked for (no finding)

- **Box across the antimeridian** (`minLng=179&maxLng=-179`): `/clients/map` answers 400 `invalid_bounds` (the schema wants min < max). The spec only asks the wrap of `boundingBox` for **nearby**, and nearby does wrap: a client at -179.99° is found from 179.99° (area A6). For a product sold in Algeria this is fine.
- **A client without a point as a stop:** accepted (200). The spec implies it ("stops without a point keep their relative order at the end").
- **An inactive client as a stop:** accepted (200). The spec says "live" only; the map hides inactive clients by default, so the picker cannot add one unless the toggle is on.
- **Livreur:** see A-1.

### Part B

#### B-1 — The position goes to Sentry, from the API and from the browser (critical)

- **Rule:** spec: the position "is **not stored, not audited, not logged**". Prompt: critical = "the user's position is stored or logged".
- **What happens**, with Sentry on (`SENTRY_DSN` for the API, `NEXT_PUBLIC_SENTRY_DSN` at web build time), each proven with a fake DSN and a local sink:
  1. **API traces:** one request in ten (`tracesSampleRate: 0.1`) is sent as a transaction whose attribute `url.full` is `/clients/nearby?lat=36.710137&lng=3.020151&radiusM=5000&limit=30`. Also for the 400 and the 401 answers.
  2. **API errors:** every 5xx on the route is sent as an event with `request.url` and `request.query_string` = `lat=36.710685&lng=3.020755&…`. Finding A-2 gives such a 500 on demand.
  3. **Browser:** the SDK keeps each `fetch` as a breadcrumb with its full URL; the next browser error of the session, whatever it is, is sent with `{"category":"fetch","data":{"url":"…/clients/nearby?lat=36.732366&lng=3.088926&radiusM=5000&limit=50"}}`.
- **Proof:** `pnpm test:map:privacy`: the six failing checks of area B2 and the failing assertion of the browser spec; `artifacts/test-35/privacy-log-and-sentry.md` (table and payload samples), `artifacts/test-35/privacy-browser.json`.
- **Cause:** `apps/api/src/instrument.ts:6-11` and `apps/web/src/instrumentation-client.ts:13-18` (and `instrumentation.ts` for SSR): `Sentry.init` without `beforeSend`, `beforeSendTransaction` or `beforeBreadcrumb`. The pino scrub (`log-privacy.ts`) covers the log only.
- **Scope of the damage:** Sentry is a third party, keeps events for weeks, and every member of the Sentry project reads them with the user's id next to them. I could not check whether production has a DSN set (that is a look at the Vercel settings, the owner's to do): if both are empty today, nothing has leaked yet and this is a trap set for the day Sentry is turned on.
- **Fix proposal:** use `stripPosition` in three hooks: `beforeSendTransaction` and `beforeSend` in the API (scrub `request.url`, `request.query_string`, `url.full`, `http.query`, span data), `beforeBreadcrumb` + `beforeSendTransaction` in the web. Better at the root: send the position in a **POST body** (`POST /clients/nearby`, still read-only), which also answers B-3; the API error events must then drop `request.data` for that route. Tests: a unit test of the scrubber on recorded payloads (take them from the proof file), and `pnpm test:map:privacy` going green.

#### B-2 — The log scrub misses `/clients/nearby/` and `/Clients/Nearby` (medium)

- **Request:** `GET /clients/nearby/?lat=36.710959&lng=3.021057` and `GET /Clients/Nearby?lat=36.711096&lng=3.021208`: Express serves both (200, same handler), and pino logs `"url":"/clients/nearby/?lat=36.710959&lng=3.021057","query":{"lat":"36.710959",…}` at `info`.
- **Proof:** `pnpm test:map:privacy`, the two failing checks of area B1; samples in `artifacts/test-35/privacy-log-and-sentry.md`.
- **Cause:** `apps/api/src/common/log-privacy.ts:5`: `/^\/clients\/nearby(?:\?|$)/`, case-sensitive, no optional slash, while Express routing is case-insensitive and not strict.
- **Why only medium:** the web never spells the route that way (it is logged clean for the real spelling, through the rewrite too, and on 400 / 401 / 500). It bites the day another client does: the Flutter app (phase 19), a proxy that adds a slash, a hand-written request.
- **Fix proposal:** match what the router matches (`/^\/clients\/nearby\/?(?:\?|$)/i`), or simpler and safer, strip `lat` / `lng` from the logged URL of **every** route. Test: three more cases in `log-privacy.spec.ts` (trailing slash, upper case, `PUBLIC_PATH_PREFIX`).

#### B-3 — Outside the app: the Vercel request logs keep the query string (owner decides)

Not tested on production, read from Vercel's documentation (`vercel.com/docs/logs/runtime`, `vercel.com/docs/drains/reference/logs`, read on 2026-11-12):

- The Logs dashboard has, for every request, a **"Request Path"** field and a **"Search Params"** field ("Search parameters of the request path"). A log drain gets **`proxy.path`: "Request path with query parameters"**.
- The browser calls the **web** project at `/api/clients/nearby?lat=…&lng=…` (`apps/web/vercel.json`), which Vercel records as an external rewrite (log source `external`, with its `destination`); the **API** project then records the function call `/clients/nearby?lat=…&lng=…`. So the position is written twice, once per project, with the IP and the time. The local copy of the rewrite shows the request line the web project receives (`pnpm test:map:privacy`, area B4).
- Retention: 1 hour on Hobby, 1 day on Pro, 3 days on Enterprise, 30 days with Observability Plus; for ever in whatever a log drain feeds.
- **Fix, if the owner wants the position out of there:** the POST body of B-1 (bodies are not in Vercel's request logs), or round the position in the browser to 3 decimals (about 100 m) before sending, which keeps the GET and its cache-free simplicity but only blurs. I would do the POST.

Two more things leave the app by design and are worth knowing, neither a bug:

- **The tile server** sees which tiles the phone loads. After "Près de moi" the map goes to zoom 14 on the user: nine tiles around `14/8332/6392` in the test, a square of about 2.4 km, with the IP. With OpenStreetMap's public tiles that is a third party; a self-hosted `NEXT_PUBLIC_MAP_TILE_URL` ends it.
- **`/clients/map` logs its view box**, and the view is centred on the user after "Près de moi" (only above 2 000 clients, when the map queries by box).

### Part C

#### C-1 — In production the new index `clients_tenant_geo_idx` is never used: row-level security hides it from the planner (medium)

- **Rule:** spec: nearby "prefilters with a bounding box computed from the radius (**uses the new index**)"; the migration exists for that.
- **What happens:** the API connects as `erp_app`, which row-level security binds (runbook, "Database roles"). Postgres then refuses to use a condition as an index condition unless its operator is *leakproof*, and the comparison operators of `numeric` (`numeric_ge`, `numeric_le`: `proleakproof = f` on PostgreSQL 16) are not. `lat` and `lng` are `numeric(9,6)`. So the lat / lng box is applied as a **filter after reading every client of the tenant**, through whatever index starts with `tenantId` (the planner takes `clients_tenantId_sectorId_idx`).
- **Proof:** `pnpm test:map:perf`, the five failing checks of area C1; `artifacts/test-35/perf-explain.md` has every statement twice, as `erp_app` and as the owner. The 1 km box in the 50 000-client tenant:
  - as `erp_app`: `Bitmap Index Scan on "clients_tenantId_sectorId_idx"` → 50 000 rows read, `Rows Removed by Filter: 16664` per worker, **1 312 buffers, 10.4 ms**;
  - the same statement as `erp` (owner, no RLS): `Index Scan using clients_tenant_geo_idx`, `Index Cond: (tenantId = … AND lat >= 36.75 AND lat <= 36.76 AND lng >= 3.05 AND lng <= 3.06)` → **38 buffers, 0.09 ms**.
- **Why nobody saw it:** an `EXPLAIN` typed in `psql` or in the Neon console runs as the owner and shows the index in use. The local dev stack connects as the owner too (`apps/api/.env`).
- **Why only medium:** it is cost, not correctness, and the budget holds (below): at 5 000 clients the whole tenant is read in 3 ms. The cost grows with the tenant, not with the box: 13 ms at 50 000 for a nearby call that should cost 1. And the index is paid for on every client write for nothing.
- **Fix proposal, tried in a rolled-back transaction on the perf database:** the `float8` comparison operators are leakproof. Two generated columns `lat_f` / `lng_f double precision GENERATED ALWAYS AS (lat::float8) STORED`, the partial index on `("tenantId", lat_f, lng_f)`, and the box written on those columns: as `erp_app` the plan becomes `Index Scan … Index Cond: (tenantId = … AND lat_f >= 36.75 …)`, 0.1 ms. (A cast inside the query, `lat::float8 >= …`, would not do: the cast is not leakproof.) Then drop `clients_tenant_geo_idx` in a later release. Test that locks it: an integration test that runs `EXPLAIN` of the nearby SQL **through the app connection** and expects the index name; the int suite already connects as `erp_app`.

#### The budget of the spec, and the numbers the prompt asked for

Local Postgres 16 on the same machine as the API: no network, warm cache. **These times are a floor**, not what Neon behind Vercel will give (add the round trip to Neon for each of the 4 to 8 statements, and the cold start).

| Case (`artifacts/test-35/perf-server.md`) | SQL as the API role (RLS on) | SQL as the table owner (no RLS) | HTTP p50 / p95 (ms) | Points |
|---|---|---|---|---|
| map, 5 000 clients, no box | no box, the geo index does not apply | same | 20.1 / 29.9 | 2 000 |
| map, 50 000 clients, no box | no box, the geo index does not apply | same | 15.4 / 18.4 | 2 000 |
| map, 50 000, one seller | | | 36.8 / 41.4 | 2 000 |
| map, 50 000, `hasDebt` | | | 61.2 / 66.1 | 2 000 |
| map, 50 000, `search` | | | 37.7 / 41.2 | 2 000 |
| map, 50 000, city box | 11.4 ms, 4 787 buffers, geo index not used | 6.6 ms, 1 323 buffers, geo index | 20.6 / 25.2 | 1 549 |
| map, 50 000, 1 km box | 10.4 ms, 1 312 buffers, geo index not used | 0.09 ms, 38 buffers, geo index | not timed over HTTP | |
| nearby, 5 000, 5 km | 3.1 ms, 347 buffers, geo index not used | 0.8 ms, 363 buffers, geo index | 6.8 / 10.9 | |
| nearby, 50 000, 5 km | 12.9 ms, 3 616 buffers, geo index not used | 7.1 ms, 3 233 buffers, geo index | 21.9 / 22.7 | |
| nearby, 50 000, 50 km | 51.4 ms, 31 624 buffers, geo index not used | 78.3 ms, 1 731 buffers, geo index | 59.2 / 62.8 | |

The body of `/clients/map` with 2 000 points is 514 kB raw and 99 kB gzip. On the widest radius the owner's plan through the index is the slower one in time (78 ms against 51 ms) although it reads 18 times fewer buffers: the index pays off on small boxes, which is the case "Près de moi" is for.

- **Budget (`/clients/map`, 2 000 points, under 400 ms):** met with a wide margin locally: p95 18 ms on 50 000 clients, 30 ms on 5 000; the worst filter (`hasDebt` on 50 000) 66 ms. Even ten times slower on Neon it holds.
- **Is `clients_tenant_geo_idx` used?** Not by the API (C-1). The first load of the map (no box) could not use it anyway: it reads the tenant's clients in name order.
- **Statements per request:** 3 to 8 whatever the number of points (transaction, `set_config` of the tenant, features and scope lookups, then **two** statements on `clients` for the map, **one** for nearby). No N+1. `artifacts/test-35/perf-statements-per-request.txt`.
- **Size of `/clients/map` with 2 000 points:** 514 kB raw, **99 kB gzip** (about 260 bytes a point). The API does not compress by itself; Vercel does at the edge. On a 3G phone 99 kB is about a second; the 30 s `Cache-Control` helps on the way back.
- **Browser, 360 × 640, CPU ×4** (`artifacts/test-35/perf-browser.json`, screenshot `perf-360-2000-points.png`): navigation → 2 000 points drawn **527 ms** (median of 3; 198 ms from the answer to the drawing); pan: worst frame 100 ms, 3 frames over 50 ms; zoom: worst frame 33 to 83 ms; JS heap 23.4 → 31.8 MB after 20 pans with their refetches (no runaway growth; one sample, not a leak hunt). **CPU ×8** (`perf-browser-x8.json`): 1 008 ms to the points, worst pan frame 200 ms. Under the 2 s line of the prompt in both.
- **Debounce:** ten pans in 2.0 s sent **2** `/clients/map` requests, each with the rounded box.

### Part D

#### D-1 — On a 360 px phone the map starts at 59 % of the screen and runs off it (medium)

- **Rule:** spec: "map takes the screen height minus the header on phone"; `docs/ui.md` phone first.
- **Path:** owner, `/clients/carte`, 360 × 640, more than 2 000 clients (the banner shows) and at least one client without a point (the link shows).
- **Actual:** header, title, subtitle, the two buttons, the "N clients sans position" link on its own line and the banner come first: the map's top edge is at **376 px of 640** and its bottom at 774 px. The first screen shows **41 %** map. In Arabic the link fits on the buttons' row, so the map starts at 324 px, gets 49 % and ends at 722 px. At 393 × 851 the map gets at least half of the first screen (that assertion passes) but still runs off it: its bottom is at 985 px in French and 933 px in Arabic. The bubble of a tapped client is drawn over the bottom of the map: its fifth button, "Ajouter à une tournée…", is below the fold, and the bubble covers what is left of the map, the tapped point included.
- **Why it hurts:** the map takes one-finger drags for itself, so the only places left to scroll the page are the strips above it.
- **Proof:** `pnpm test:map:web`, test "/clients/carte: fits the phone…", two soft assertions, in the four phone projects; screenshots `m360-fr-carte.png`, `m360-ar-carte.png`, `m360-fr-bulle.png`.
- **Cause:** `apps/web/src/components/geo/clients-map-screen.tsx:202`: `h-[calc(100svh-15rem)] min-h-80`: the 15 rem assume one row above the map; the title block, the link row and the banner add about 9 rem, and `min-h-80` (320 px) wins on a 640 px screen anyway.
- **Fix proposal:** on phones drop the title block (the top bar already says "Carte des clients"), put the link and the banner inside the map box as overlays, and size the map with a flex column (`flex-1 min-h-0`) instead of a guessed `calc`. Lock: the two assertions of this test.

#### D-2 — A failed "Clients proches" request is shown as "Aucun client dans ce rayon" (medium)

- **Path:** `/clients/carte` → "Près de moi" → the API answers 500 (or the phone has no network): after the retries the sheet shows the empty state "Aucun client dans ce rayon."
- **Expected:** an error message with a way to retry (AGENTS.md / `docs/ui.md`: every list has loading, empty and error states).
- **Why it matters:** a seller without signal is told that he has no client around him. With finding A-2 any search containing a NUL byte gives the same lie; a 403 (permission revoked) too.
- **Proof:** `pnpm test:map:web`, test "Près de moi…", soft assertion "a failed nearby request is shown as…"; screenshot `m360-fr-proches-erreur.png`.
- **Cause:** `apps/web/src/components/geo/nearby-sheet.tsx:80-86`: `isPending` then `!near.data || near.data.length === 0` → `EmptyState`; `near.isError` is never read.
- **Fix proposal:** an `Alert` with `useErrorMessage()` and a "Réessayer" button when `near.isError`; test: route `/clients/nearby` to a 500 in `mobile.spec.ts` and expect the alert.

#### D-3 — In the picker, "Tous mes clients" above 2 000 clients: the banner says "zoomez", zooming loads nothing (medium)

- **Path:** owner (4 050 clients on the map) → a tournée → "Choisir sur la carte" → "Tous mes clients". The banner "Plus de 2 000 clients : zoomez ou filtrez pour tous les voir" appears. Zoom in four times.
- **Expected:** the picker asks for the current view, as `/clients/carte` does (spec: "the map then sends the current bounds with the next query").
- **Actual:** no request with `minLat…` is ever sent from the sheet. The picker keeps the first 2 000 clients **by name**; a client whose name comes after them cannot be picked on the map at any zoom, and the sheet has no filter. "Ajouter les clients visibles (N)" counts among those 2 000 only.
- **Proof:** `pnpm test:map:web`, test "Ajouter les clients visibles (N)…", soft assertion "requests for the zoomed view in the picker"; screenshot `m360-fr-tous-mes-clients-tronque.png`.
- **Cause:** `apps/web/src/components/tournees/route-map-sheet.tsx:48`: `useClientMap(filters, null, open)`: the bounds the sheet tracks (`:51`) are used for the "visible" count, never sent.
- **Who meets it:** an owner or supervisor with more than 2 000 located clients in his scope who turns the toggle on. The default view (the route's seller) is fine below 2 000 clients per seller.
- **Fix proposal:** the same `byView` logic as `clients-map-screen.tsx:95-99` (pass the rounded bounds once `truncated`); test: this assertion.

#### D-4 — The browser's back button leaves the route editor and drops the unsaved picks without asking (medium)

- **Rule:** spec: "the existing sticky Enregistrer and the `beforeunload` guard still apply"; prompt: "a route save loses … stops" is critical, this is the unsaved case, hence medium.
- **Path:** route editor → "Choisir sur la carte" → add two clients → "Terminé" → press the phone's back button (or tap a menu link).
- **Actual:** the app goes back to the list of tournées, no prompt, the picks are gone. A full reload or closing the tab does prompt (`beforeunload` fires; the same test checks it).
- **Proof:** `pnpm test:map:web`, test "route editor…", soft assertion "the back button leaves the editor and drops the unsaved stops without asking".
- **Cause:** `apps/web/src/components/tournees/route-editor.tsx:124-130`: only `window.beforeunload`, which a client-side navigation of Next.js never fires. Older than phase 35, but phase 35 makes the unsaved list long (a tap per client, "Ajouter les clients visibles") and the back button is how a phone user closes a full-screen sheet.
- **Fix proposal:** a navigation guard for in-app routes (intercept `popstate` and link clicks while `stopsDirty`, confirm with the same sentence), or autosave of the draft in memory per route id; test: this assertion.

#### D-5 — A position known to ± 5 km is used as if it were exact (low)

- **Path:** the phone has no GPS fix (indoors, cell towers only: accuracy 5 000 m). "Près de moi" opens "Clients proches" with distances to the metre from a point that may be 5 km off; nothing on the screen says so. The accuracy circle is drawn, but under the sheet.
- **Expected by the prompt:** "the map still loads and the explanation shows". The map loads; there is no explanation, and no message key for one.
- **Proof:** `pnpm test:map:web`, test "position refused, never answered, vague…", soft assertion "the screen says the position is imprecise"; screenshot `m360-fr-position-imprecise.png`.
- **Cause:** `apps/web/src/lib/client-map.ts:128-137` keeps `accuracyM`; `nearby-sheet.tsx` never shows it. Phase 17 already has the notion (`geoMaxAccuracyM`, LOW_ACCURACY).
- **Fix proposal:** one line in the sheet when `accuracyM` is above the tenant's `geoMaxAccuracyM`: "Position approximative (± 5 km)"; three message keys.

Refused and never-answered positions are handled: the explanation shows, the button comes back, the map stays (the wait is the 10 s the app asks the browser for).

#### D-6 — At 360 px the nearby list leaves 76 px to the client's name (low)

- **Path:** "Clients proches" at 360 px with a balance of seven digits (`1 234 567,89 DA`): the row is name, balance, call button, directions button; the name gets **76 px** ("Épiceri…"), 109 px at 393. Three clients of the same street look the same.
- **Proof:** `pnpm test:map:web`, test "Près de moi…", soft assertion "width left to the client name" (fails at 360, passes at 393); screenshot `m360-ar-proches.png`.
- **Cause:** `nearby-sheet.tsx:93-125`: one row, the amount and two 44 px buttons never shrink.
- **Fix proposal:** two lines per row below `sm` (name on the first, distance and balance on the second), as the card lists of `docs/ui.md` do.

### Part E

#### E-1 — The deploy step in the README does not say which database it migrates (low)

- **What the README says** (`README.md:110`): "run `pnpm --filter @erp/api db:deploy` on Neon after deploying." The step is there, and the command is the right one (`prisma migrate deploy`, which only applies pending migrations).
- **What is missing:** `apps/api/prisma.config.ts` reads `DATABASE_URL_MIGRATE ?? DATABASE_URL` from the environment, then from `apps/api/.env`. Typed as written on a developer machine, the command migrates the **local** database of `.env` and prints "All migrations have been successfully applied". Nothing in the README or in `docs/runbook.md` (which covers the VPS, not Neon) says to set `DATABASE_URL_MIGRATE` to Neon's **owner, direct (non-pooler)** string for that one command.
- **Fix proposal:** write the full line in the README, `DATABASE_URL_MIGRATE='postgresql://<owner>@<neon-direct-host>/<db>?sslmode=require' pnpm --filter @erp/api db:deploy`, and a two-line "Neon" paragraph in the runbook with the check below.

#### Does the migration lock `clients`, and does it matter?

`artifacts/test-35/migration-lock.md`, `pnpm test:map:lock`. A writer updates one client every 3 ms while the exact statement of the migration runs; three runs each.

| Case | Index build | Worst client write during it | Worst read | Lock on the table |
|---|---|---|---|---|
| `CREATE INDEX`, 50 000 rows | 44 to 53 ms | 41 to 50 ms | 1 to 9 ms | `ShareLock` |
| `CREATE INDEX`, 145 000 rows | 109 to 144 ms | 103 to 137 ms | 1 to 18 ms | `ShareLock` |
| `CREATE INDEX CONCURRENTLY`, 145 000 rows | 146 to 200 ms | 19 to 36 ms | 10 to 13 ms | `ShareUpdateExclusiveLock` |

- **Yes, it locks writes:** the plain `CREATE INDEX` takes a `SHARE` lock; every insert or update of a client waits for the whole build, reads go through.
- **For how long:** about **50 ms on 50 000 rows** locally. On Neon count a few times that (smaller instance, cold storage): well under a second.
- **Does it matter for the pilot?** No. A pilot grossiste has a few thousand clients; a write that waits 50 ms is not seen, and no request times out. It would start to matter in the millions of rows; `CONCURRENTLY` is not needed here (and Prisma runs a migration in a transaction, where it is not allowed).
- **Additive and safe:** one `CREATE INDEX`, no column, no rewrite; the deployed version keeps working without it (and, after C-1, with it).

#### Is `db:deploy` still owed on Neon?

I cannot tell without touching production, which this pass does not do. The route `/clients/map` works without the index, so its behaviour proves nothing either way. **Owner, one read-only check** in the Neon SQL editor:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = '20261110140000_clients_geo_index';
SELECT indexname FROM pg_indexes WHERE indexname = 'clients_tenant_geo_idx';
```

No row = the step is still owed. Given C-1, running it late costs nothing: the API does not use this index.

## 6. What holds up well

### Part A

- **Scope** (owner, manager, supervisor, team seller, outside seller): the ids of `/clients/map` equal, as sets, the spec's scope computed from the tables **and** `GET /clients?hasLocation=true` for the same user. The supervisor never gets a client of the seller outside his team, by map, by nearby centred on it, or by `assignedSellerId`. `withoutLocation` counts only the user's own clients.
- **Tenant isolation**, with RLS on (API connected as `erp_app`): tenant B's 300 clients sit on A's coordinates and never show up, for any role, on the map or within 100 m / 50 km of 60 of those exact points; B's sector, seller and client ids as filters give nothing; A cannot read or write B's route, nor put B's client on its own.
- **Filters:** the 64 combinations of the six filters match the tables (ids in order, `truncated`, `withoutLocation`) for the owner and for the supervisor; the same 64 on nearby return the 100 nearest. `%`, `_`, `\`, quotes, HTML and Arabic are searched as plain text. `hasLocation=true|false` splits the list exactly with every other filter.
- **Cap:** 4 050 matches → 2 000 points, `truncated`, ordered by name then id; a box with 1 999 / 2 000 / 2 001 clients flips `truncated` at the right place; the box is inclusive; the DTO has the twelve fields of the spec and nothing else.
- **Hostile input:** 81 of 85 requests are handled (400 with a `code`, or a correct 200); the 4 others are finding A-2.
- **Nearby geometry:** 4 990 m is in at 5 000, 5 010 m is out, north, south, east, west and diagonal, at 30°N and on the equator; correct next to the pole and across ±180°; `distanceM` is an integer within 1 m of `haversineM`, ascending; a five-way tie is ordered by name then id on every call.
- **Feature gates:** Essentiel and "Distribution minus `GEO_CHECK`" are refused on both routes with `FEATURE_NOT_IN_PLAN`; revoking `CLIENTS_VIEW` refuses the next request of the same token.
- **Route stops:** picked order kept, 300 accepted, 301 / duplicate / archived / unknown / other tenant refused with nothing saved, supervisor refused outside his team, SELLER and LIVREUR get 403. **Two planners at the same time, 25 rounds, and five planners with 300 stops, 5 rounds:** the list is always exactly one of the submitted lists, positions 1..n, two audit rows a round, no 500, no deadlock. A save changes no client row.
- **`RouteDto.start`:** right in every case tried but one (A-5); never a deleted dépôt, never another tenant's.
- **`orderByNearest`:** 800 random sets of 0 to 300 points: always a permutation, unlocated stops last in their order, deterministic, greedy at every step, ties in input order; 300 stops in well under 50 ms. `boundingBox` never left out a point within the radius on 20 000 random draws.

### Part B

- **The pino log is clean for every request the web sends:** direct, with filters, through the `/api` rewrite, and on the 400, the 401 and the 500 answers (the error line of the exception filter is scrubbed too). 1 077 log lines read. The access token never appears (`authorization` is redacted).
- **Nothing is stored:** after the sessions, no text, numeric or json column of any table holds the coordinates, whole or cut to four decimals (`e2e/sql/map-privacy.sql`); no audit row is written.
- **The browser keeps nothing:** not in the URL, `localStorage` (one key, `erp_session_hint`), `sessionStorage`, cookies, IndexedDB or Cache Storage; no service worker; no analytics script; the TanStack Query cache is in memory only. The only hosts called besides the app are the tile server and Sentry.
- **Production** answers 401 to an anonymous `GET /clients/map` and `GET /clients/nearby` on the API project (`erp-saas-pi.vercel.app`). These two requests are the only ones sent to production in this pass.

### Part C

- The 400 ms budget, the 2 s line on a slowed phone, the debounce and the absence of N+1: all met (numbers in section 5, part C).
- Canvas rendering does its job: 2 000 points cost about 200 ms of main thread at CPU ×4.

### Part D

Checked at 360 and 393 px in Arabic and French and at 1280 px in French, with the same result everywhere:

- **No sideways scroll** on any of the screens, sheets and bubbles, in either direction of writing; no raw message key in `ar`, `fr` or `en`.
- "Filtres" and "Près de moi" are on the first screen; the badge counts the filters right (3, then 4 with a search, then none after "Effacer") and sits at the end of the button in both directions; the legend writes the four states; the truncated banner shows; "N clients sans position" opens `/clients?hasLocation=false` with its chip; a deep link `/clients?hasDebt=true&hasLocation=true&sort=balance_desc` still works (phase 33 has no `?filtre=` link to the client list; that parameter only exists on the stock page).
- **Refused position:** the explanation shows, the map stays, the button comes back. **Never answered:** the spinner ends at the 10 s the app asks for, with "Position introuvable".
- **Bubble:** "Fiche client" → `/clients/:id`, `tel:` with the phone, "Itinéraire" → `…/maps/dir/?api=1&destination=<lat>,<lng>` in the right order and in a new tab, balance `1 234 567,89 DA`, the state written ("Plafond dépassé"). "Ajouter à une tournée…" offers only the routes of the client's seller, adds at the end without touching the other stops, and the toast's "Ouvrir la tournée" opens that route. A seller's bubble has no such button.
- **Route editor:** a new tournée shows the hint; the picker is full height on a phone; three taps give markers 1, 2, 3 on the right clients; "Retirer" renumbers; "Terminé" hands the two stops to the list in order; a reload with unsaved stops raises the `beforeunload` prompt; "Enregistrer" then a reload shows them; the API has them in that order. **The map inside the sheet has no grey hole** after the slide-in and after turning the phone.
- **"Ajouter les clients visibles (N)":** N is right (8), and above the room left it refuses with "Une tournée a au plus 300 arrêts" without asking to confirm; 296 numbered markers stay usable.
- **Seller's day:** the "Carte" toggle shows one numbered marker per located stop, a check mark on the visited one and "Visité aujourd'hui" in its bubble; "Près de moi" returns only his own clients although other sellers have dozens within 5 km.
- **Keyboard and screen reader basics:** every control of the filters sheet, the nearby sheet, the picker and the bubble has a name; Tab stays inside each of the three sheets; Escape closes the filters sheet and the nearby sheet (not tried on the picker).

### Part E

- The migration is additive, short, and harmless to a live pilot database.

## 7. Not tested, and why

- C: Neon itself. The times are local; the plans are not (same PostgreSQL major version, same role, same RLS policies), so C-1 holds there, but the milliseconds must be read again on Neon by the owner (`EXPLAIN` **as the app role**, not from the console's default role).
- C: a real cheap Android. CPU ×4 and ×8 on a fast laptop stand in for it; GPU, memory pressure and a real touch screen do not come with the throttle.
- D: a real phone. Touch gestures were mouse events on a phone-sized Chromium; pinch zoom, the on-screen keyboard over the search field, and a real GPS were not tried. A screen reader was not run: names, focus and Escape were checked, not the reading order.
- D: 1280 px in Arabic, and Safari / Firefox: not in the prompt's list, not run.
- A: with row-level security **off** (API connected as the owner): planned as a second look at tenant isolation, not done for lack of time; with RLS on, as in production, isolation holds.
- A: a STOREKEEPER on the map (suspected same as the livreur, A-1).
- E: whether the migration has been applied on Neon (see the two queries in part E).
- B: whether production has a Sentry DSN set, and what its Vercel logs really hold: both need the owner's accounts. The public URL of the **web** project is not in the repo, so the 401 through `/api/…` on production was not checked (the API project was).
- B: the SSR side of the web (`instrumentation.ts`) never sees the position (the map is client-only), so it was read, not tested.

## 8. Go / no-go: show the map to the pilot sellers?

**No-go as it stands. Go after three small fixes and two answers from the owner.** None of them is long.

What a seller touches is sound: he sees his own clients and nobody else's, on the map, in "Clients proches" and on his day; another company's clients never show up, even on the same coordinates; distances are right to the metre; the map is fast on a slowed 360 px phone; nothing about his position is kept in the database, in the API log or in his browser.

What stops me from saying go today:

1. **B-1, the seller's position goes to Sentry** as soon as a DSN is set (API traces, API errors, browser errors). The feature was sold to the sellers as "your position is never kept". Owner: look at the two Vercel projects. If `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are both empty in production, nothing has leaked and this is not blocking for the first demo, but it must be fixed before Sentry is turned on. If either is set, fix first.
2. **A-1, a livreur's phone shows every client of the company with its debt.** Not a seller, but the same pilot, the same week. The owner must say which sentence is right, the spec's or the code's. If the pilot company has no livreur account, this does not block the sellers.
3. **A-2, a 500 on a search with a NUL byte**, and **D-2, a failed "Clients proches" shown as "no client around you"**: the second one is what a seller will meet in the field the first time he has no signal, and it tells him something false.
4. **A-7, the lost stop**: "Ajouter à une tournée…" on the map silently undoes another planner's addition made a moment before. Critical by the rule, but sellers do not plan, so it does not block showing **them** the map. It does mean: until PR 4, one planner at a time on a tournée, and tell them so.

With PR 1 and PR 2 below merged (PR 1 can wait if both DSNs are empty), and the owner's answer on the livreur: **go for the sellers.** The rest can follow during the pilot.

## 9. Fix plan (small PRs, in this order; none is opened by this pass)

| # | PR | Findings | The test that locks it |
|---|---|---|---|
| 1 | **Position out of Sentry and out of every log spelling.** `beforeSend` / `beforeSendTransaction` in `instrument.ts`, `beforeBreadcrumb` / `beforeSendTransaction` in `instrumentation-client.ts`, all through `stripPosition`; the regex of `log-privacy.ts` follows the router (case, trailing slash). | B-1, B-2 | Unit tests of the scrubber on the payloads kept in `artifacts/test-35/privacy-log-and-sentry.md`; three cases in `log-privacy.spec.ts`; `pnpm test:map:privacy` green. |
| 2 | **Input and error states.** Refuse control characters in the shared `search`; Postgres `22021` → 400 in the exception filter; `lat` / `lng` / box parsed from a strict decimal string instead of `z.coerce.number()`; the nearby sheet shows its error with "Réessayer". | A-2, A-6, D-2 | `schemas/clients.test.ts` (`\0`, empty, hex, space); one line per route in `client-map.int-spec.ts`; a Playwright step that answers 500 to `/clients/nearby`. |
| 3 | **The livreur rule** (after the owner's answer): in `ScopeService.of`, so the list and the map stay equal. Write the rule for a planned stop outside the seller's scope in `docs/domain.md` at the same time. | A-1, A-3 | `client-map.int-spec.ts`: a livreur's map, nearby and list hold only what the rule says; the set comparison "map = list" of `e2e/api/map.ts`. |
| 4 | **No lost stop.** `PUT /routes/:id/stops` takes the list the client started from (or a route `version`) and answers 409 when the route changed since; the dialog retries on 409 by reading again; the editor shows "la tournée a changé". An in-app navigation guard on the editor while stops are unsaved. | A-7, D-4 | Integration: two saves from the same read, the second is refused. `e2e/api/map.ts` check "both clients end on the route"; the back-button assertion of `map.spec.ts`. |
| 5 | **Phone layout and the picker.** The map takes the screen under the header at 360 px (link and banner as overlays); the picker queries by view once truncated; "Position approximative (± x km)" in the nearby sheet; more room for the client name in the nearby list. | D-1, D-3, D-5, D-6 | The soft assertions of `map.spec.ts` that fail today, in the four phone projects. |
| 6 | **The index the API can use.** Generated `double precision` columns for lat / lng, the partial index on them, the box and the nearby prefilter written on them; drop `clients_tenant_geo_idx` one release later. `sellerDepotPoint` falls back to the dépôt principal when the own dépôt has no point. The README line for Neon. | C-1, A-5, E-1 | An integration test that runs `EXPLAIN` through the app connection and expects the index; the A9 check of `e2e/api/map.ts`; `pnpm test:map:perf` area C1 green. |
| 7 | **Owner's decisions, no code until he answers.** The position in a POST body instead of the query string (Vercel request logs, B-3); a self-hosted or paid tile server before real use (OSM policy, and the tile host sees where the user is); whether `GEO_CHECK` must hide stored coordinates (A-4). | B-3, A-4 | For the POST: `pnpm test:map:privacy`, area B4, expects no position in the request line. |

## 10. Definition of done of the prompt

| Line | State |
|---|---|
| Parts A to E in the report | done |
| Every finding reruns with one command | done: the command is named in each finding (section 2 has the five commands) |
| `git diff --stat origin/main -- apps packages` empty | done: empty on 2026-11-13 against `origin/main` = `ee2df3d` (fetched; main has not moved since the pass began) |
| The new suites fail only on the findings they prove | done: every failing check is named in section 4 with its finding; `pnpm lint && pnpm typecheck && pnpm test` pass again at the end, run without Turbo's cache (`turbo run lint typecheck test --force`, 10/10 tasks, 5 min): API 64 suites / 846 tests, shared 34 test files, web 12 test files, lint 0 errors. Run on Node 26, the only Node on this machine; `.nvmrc` and CI say 22. |
| No request to production but an anonymous `GET` | done: two requests, `GET /clients/map` and `GET /clients/nearby` on `erp-saas-pi.vercel.app`, no header, both 401 |
| PR `test/phase-35-client-map` | the branch is pushed together with this commit; `gh` is not installed on this machine, so the PR text is in `e2e/artifacts/test-35/PR.md` for the owner to open it. No fix PR is opened. |

## 11. What this pass left on the machine

- Two local databases in the `erp-saas-db-1` container, `erp_t35` and `erp_t35_perf`, kept so every finding can be rerun (`dropdb -U erp erp_t35 erp_t35_perf` removes them), and the role `erp_app`, created as the runbook says for an existing database. The dev database `erp` was not written to.
- `apps/web/.next` and `apps/api/dist` are the audit builds (API URL `localhost:3003`, a fake Sentry DSN): run `pnpm build` again before using the dev stack from built output.
- Git-ignored: `e2e/.auth/map-*.json` (fixtures and sessions), `e2e/test-results/`.
