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
| B. Privacy of the position | not started | |
| C. Performance | not started | |
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
```

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

The 7 failures of part A are the proofs of findings A-1 (3 checks), A-2, A-4, A-5 and A-6; nothing else fails. A-3 is proven by a proof file, not by a failing check.

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

## 7. Not tested, and why

- Parts B to E: not started yet (see the status table).
