# Test report — phase 35, client map and route picking

**Target:** `ee2df3d` (`origin/main`; phase 35 is PR #62: `803ad15` API, `d6f2192` web, `d74e67f` docs).
**Branch:** `test/phase-35-client-map`. **Date:** 2026-11-12.
**Prompt:** [`docs/prompts/test-35-client-map.md`](../docs/prompts/test-35-client-map.md). **Spec:** [`phase-35-client-map.md`](../docs/prompts/phase-35-client-map.md).
**Rule of the pass:** find and prove, do not fix. Nothing under `apps/` or `packages/` is changed.

## Status (read this first when resuming)

| Part | State | Commit |
|---|---|---|
| 0. Baseline and seed | done | `test(e2e): phase 35 baseline and map seed` |
| A. API correctness | done | `test(e2e): phase 35 map API checks (part A)` |
| B. Privacy of the position | done | `test(e2e): phase 35 position privacy checks (part B)` |
| C. Performance | done | `test(e2e): phase 35 performance measurements (part C)` |
| D. Web and phone | not started | |
| E. Upgrade path on Neon | not started | |
| Final report, go / no-go, fix plan | not started | |

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
| A | `api/map.ts` | 75 | 64 | **7** | 4 |
| B | `api/map-privacy.ts` | 26 | 12 | **8** | 6 |
| B | `web/position-privacy.spec.ts` (m393-fr) | 9 assertions | 8 | **1** | 0 |
| C | `api/map-perf.ts` | 18 | 10 | **5** | 3 |
| C | `web/map-perf.spec.ts` (m360-fr) | 7 assertions | 7 | 0 | 0 |

The 7 failures of part A are the proofs of findings A-1 (3 checks), A-2, A-4, A-5 and A-6; nothing else fails. A-3 is proven by a proof file, not by a failing check.
The 9 failures of part B are the proofs of B-1 (6 API checks and the browser assertion) and B-2 (2 checks).
The 5 failures of part C are the proof of C-1.

## 5. Findings

Severity as defined by the prompt. Each proof reruns with the command of its part; the files are in
`e2e/artifacts/test-35/`.

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

| Case | As the API role (RLS on) | As the table owner (no RLS) | HTTP p50 / p95 (ms) | Body / gzip |
|---|---|---|---|---|

- **Budget (`/clients/map`, 2 000 points, under 400 ms):** met with a wide margin locally: p95 18 ms on 50 000 clients, 30 ms on 5 000; the worst filter (`hasDebt` on 50 000) 66 ms. Even ten times slower on Neon it holds.
- **Is `clients_tenant_geo_idx` used?** Not by the API (C-1). The first load of the map (no box) could not use it anyway: it reads the tenant's clients in name order.
- **Statements per request:** 3 to 8 whatever the number of points (transaction, `set_config` of the tenant, features and scope lookups, then **two** statements on `clients` for the map, **one** for nearby). No N+1. `artifacts/test-35/perf-statements-per-request.txt`.
- **Size of `/clients/map` with 2 000 points:** 514 kB raw, **99 kB gzip** (257 bytes a point). The API does not compress by itself; Vercel does at the edge. On a 3G phone 99 kB is about a second; the 30 s `Cache-Control` helps on the way back.
- **Browser, 360 × 640, CPU ×4** (`artifacts/test-35/perf-browser.json`, screenshot `perf-360-2000-points.png`): navigation → 2 000 points drawn **527 ms** (median of 3; 198 ms from the answer to the drawing); pan: worst frame 100 ms, 3 frames over 50 ms; zoom: worst frame 33 to 83 ms; JS heap 23.4 → 31.8 MB after 20 pans with their refetches (no runaway growth; one sample, not a leak hunt). **CPU ×8** (`perf-browser-x8.json`): 1 008 ms to the points, worst pan frame 200 ms. Under the 2 s line of the prompt in both.
- **Debounce:** ten pans in 2.0 s sent **2** `/clients/map` requests, each with the rounded box.

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

## 7. Not tested, and why

- Parts D and E: not started yet (see the status table).
- C: Neon itself. The times are local; the plans are not (same PostgreSQL major version, same role, same RLS policies), so C-1 holds there, but the milliseconds must be read again on Neon by the owner (`EXPLAIN` **as the app role**, not from the console's default role).
- C: a real cheap Android. CPU ×4 and ×8 on a fast laptop stand in for it; GPU, memory pressure and a real touch screen do not come with the throttle.
- B: whether production has a Sentry DSN set, and what its Vercel logs really hold: both need the owner's accounts. The public URL of the **web** project is not in the repo, so the 401 through `/api/…` on production was not checked (the API project was).
- B: the SSR side of the web (`instrumentation.ts`) never sees the position (the map is client-only), so it was read, not tested.
