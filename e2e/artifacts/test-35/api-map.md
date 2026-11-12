# test-35/api-map

Total 75 · PASS 64 · FAIL 7 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| A1 scope — the map and the nearby list against the client list and the tables | owner: /clients/map (all slices, inactive included) = the spec's scope, as a set | PASS | 4319 clients |  |
| A1 scope — the map and the nearby list against the client list and the tables | owner: /clients/map = GET /clients?hasLocation=true for the same user, as a set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | owner: /clients/nearby (50 km around Alger, 100 nearest) stays in the same set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | manager: /clients/map (all slices, inactive included) = the spec's scope, as a set | PASS | 4319 clients |  |
| A1 scope — the map and the nearby list against the client list and the tables | manager: /clients/map = GET /clients?hasLocation=true for the same user, as a set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | manager: /clients/nearby (50 km around Alger, 100 nearest) stays in the same set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | supervisor: /clients/map (all slices, inactive included) = the spec's scope, as a set | PASS | 2625 clients |  |
| A1 scope — the map and the nearby list against the client list and the tables | supervisor: /clients/map = GET /clients?hasLocation=true for the same user, as a set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | supervisor: /clients/nearby (50 km around Alger, 100 nearest) stays in the same set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller1 (in the team): /clients/map (all slices, inactive included) = the spec's scope, as a set | PASS | 1075 clients |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller1 (in the team): /clients/map = GET /clients?hasLocation=true for the same user, as a set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller1 (in the team): /clients/nearby (50 km around Alger, 100 nearest) stays in the same set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller outside the team: /clients/map (all slices, inactive included) = the spec's scope, as a set | PASS | 600 clients |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller outside the team: /clients/map = GET /clients?hasLocation=true for the same user, as a set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller outside the team: /clients/nearby (50 km around Alger, 100 nearest) stays in the same set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | livreur: /clients/map (all slices, inactive included) = the spec's scope, as a set | FAIL | 0 clients | 4319 points for 0 expected: 4319 outside the scope, 0 missing |
| A1 scope — the map and the nearby list against the client list and the tables | livreur: /clients/map = GET /clients?hasLocation=true for the same user, as a set | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | livreur: /clients/nearby (50 km around Alger, 100 nearest) stays in the same set | FAIL |  | 100 of 100 nearby clients are outside the spec's scope, e.g. T35-00015 assigned to null |
| A1 scope — the map and the nearby list against the client list and the tables | supervisor: no client of the seller outside his team, on the map or nearby | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | seller1: asking for another seller's clients (filter, search by exact code, centre on it) gives nothing | PASS |  |  |
| A1 scope — the map and the nearby list against the client list and the tables | `withoutLocation` counts only the user's own clients, for each role | FAIL |  | livreur: withoutLocation 500, expected 0 |
| A2 tenant isolation — tenant B sits on the very same coordinates | A's whole map holds no client of B, for every role | PASS |  |  |
| A2 tenant isolation — tenant B sits on the very same coordinates | nearby centred on 60 coordinates of B (100 m and 50 km) never returns a client of B | PASS |  |  |
| A2 tenant isolation — tenant B sits on the very same coordinates | B's sector id, seller id and client id as filters or search give nothing and no 500 | PASS |  |  |
| A2 tenant isolation — tenant B sits on the very same coordinates | B's owner sees his 300 clients and none of A's; B's seller only his own | PASS |  |  |
| A2 tenant isolation — tenant B sits on the very same coordinates | a route of B is not found by A; a client of B is refused as a stop of A's route | PASS |  |  |
| A3 filters — every combination against the tables | /clients/map: the 64 combinations of the six filters (ids in order, truncated, withoutLocation) | PASS |  |  |
| A3 filters — every combination against the tables | /clients/map: the same 64 combinations for the supervisor (scope and filters together) | PASS |  |  |
| A3 filters — every combination against the tables | /clients/nearby: the 64 combinations, 50 km around Alger, the 100 nearest | PASS |  |  |
| A3 filters — every combination against the tables | search treats %, _ and \ as plain characters (map, nearby, list) | PASS |  |  |
| A3 filters — every combination against the tables | GET /clients?hasLocation=true|false splits the list exactly, alone and with the other filters | PASS |  |  |
| A4 cap — 2 000 points, the edge at 1 999 / 2 000 / 2 001 | 4069 clients match: 2 000 points, truncated, ordered by name then id | PASS |  |  |
| A4 cap — 2 000 points, the edge at 1 999 / 2 000 / 2 001 | a box holding exactly 1 999, 2 000 and 2 001 clients | PASS |  |  |
| A4 cap — 2 000 points, the edge at 1 999 / 2 000 / 2 001 | the box is inclusive on its four edges | PASS |  |  |
| A4 cap — 2 000 points, the edge at 1 999 / 2 000 / 2 001 | the point DTO is the compact one of the spec, nothing more | PASS |  |  |
| A5 hostile input — 400 with a code, never 500 | 85 hostile requests: none answers 500 | FAIL | 400 VALIDATION_FAILED (AGENTS.md §4: every input validated) | search with a NUL byte: HTTP 500 INTERNAL_ERROR (/clients/map?search=%00) \| search with a NUL byte inside: HTTP 500 INTERNAL_ERROR (/clients/map?search=abc%00def) \| nearby search with a NUL byte: HTTP 500 INTERNAL_ERROR (/clients/nearby?lat=36.75&lng=3.06&search=%00) \| list search with a NUL byte (older route, for comparison): HTTP 500 INTERNAL_ERROR (/clients?hasLocation=true&search=%00) — table in artifacts/test-35/hostile-inputs.md |
| A5 hostile input — 400 with a code, never 500 | every input the spec forbids answers 400 with a `code`; every edge value it allows answers 200 | PASS |  |  |
| A5 hostile input — 400 with a code, never 500 | inputs the schema lets through although they are not plain decimal numbers | INFO |  | exponent notation inside the range; hexadecimal (0x24 = 36); empty value; a space; 10 000 decimals; broken percent-encoding in search; search as an array; a tenantId parameter; empty lat and lng; exponent notation inside the range |
| A5 hostile input — 400 with a code, never 500 | an empty `lat=&lng=` is not read as the position 0, 0 | FAIL | 400 VALIDATION_FAILED | HTTP 200: the empty strings were coerced to 0 (z.coerce.number, packages/shared/src/schemas/clients.ts:105-106), so the route searched around 0°N 0°E |
| A5 hostile input — 400 with a code, never 500 | no token → 401 on both routes | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | Sahara (30°N): r=5000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | Sahara (30°N): r=5010 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | Sahara (30°N): r=4989 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | equator: r=5000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | near the north pole (89.95°N): r=20000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | near the north pole (89.95°N): r=5000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | on the pole: r=6000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | next to the antimeridian (179.99°E): r=5000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | next to the antimeridian (179.99°E): r=50000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | from the other side (-179.99°): r=5000 m returns exactly the edge clients within the radius | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | distanceM is sorted ascending; `limit` keeps the nearest | PASS |  |  |
| A6 nearby — the radius edge, the poles, the equator, the antimeridian | five clients on one point: the tie is ordered by name then id, the same on 10 calls | PASS |  |  |
| A7 feature gates | Essentiel (no GEO_CHECK): map and nearby refused with FEATURE_NOT_IN_PLAN | PASS |  |  |
| A7 feature gates | Distribution with GEO_CHECK revoked and TOURNEES kept: map and nearby refused | PASS |  |  |
| A7 feature gates | without GEO_CHECK: do GET /routes/:id and GET /me/today still hand out client lat/lng and the dépôt start point? | INFO |  | routes/:id YES, me/today YES; the phase 17 client DTO (GET /clients) also carries `location` there |
| A7 feature gates | without GEO_CHECK the route DTO carries no coordinates (stops lat/lng null, start null) | FAIL | no coordinates without GEO_CHECK (spec: "the map needs Feature.GEO_CHECK") | routes/:id leaks: true, me/today leaks: true (see geo-check-off-coordinates.json) |
| A7 feature gates | permission CLIENTS_VIEW revoked from a user → map and nearby refused, given back → allowed | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | clients picked on the map are saved in the picked order, positions 1..n, with their points | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | 300 stops accepted and kept in order; 301 refused and nothing changed | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | a client twice in the list is refused and nothing changed | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | an archived client is refused; an unknown id is refused; a malformed id is refused | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | a client without a point as a stop | PASS | accepted: the spec keeps "stops without a point … at the end" of "Ordonner par proximité", so they are valid stops | HTTP 200; the stop comes back with lat null |
| A8 route stops picked from the map — PUT /routes/:id/stops | an inactive client (active = false) as a stop | INFO |  | HTTP 200. The spec only says clients "must be live"; the map hides inactive clients by default but the API takes them. |
| A8 route stops picked from the map — PUT /routes/:id/stops | the supervisor cannot add a client of the seller outside his team; the owner can | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | the supervisor cannot read or write a route of the seller outside his team | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | a SELLER and a LIVREUR cannot call PUT /routes/:id/stops, even on the seller's own route | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | a client outside the seller's scope, planned on his route by the owner: what the seller sees | INFO |  | map 0 point, client page HTTP 404, but GET /routes/:id shows it with lat 36.89816 and GET /me/today shows it with name, phone, point and balance 1500.00 |
| A8 route stops picked from the map — PUT /routes/:id/stops | two planners save the same route at the same time, 25 rounds: the list is one of the two, never a mix; two audit rows each round | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | five planners racing on one route with 300 stops each, 5 rounds: no 500, no deadlock, no lost position | PASS |  |  |
| A8 route stops picked from the map — PUT /routes/:id/stops | PUT stops writes no client row and no position anywhere else (only route_stops and audit_logs change) | PASS |  |  |
| A9 RouteDto.start — the dépôt of the route's seller (sellerDepotPoint) | dépôt principal without a point: one OPERATE dépôt with a point → that point; every other case → null | PASS |  |  |
| A9 RouteDto.start — the dépôt of the route's seller (sellerDepotPoint) | dépôt principal with a point: two dépôts, a truck only, no access, VIEW_STATS only → the dépôt principal | PASS |  |  |
| A9 RouteDto.start — the dépôt of the route's seller (sellerDepotPoint) | one OPERATE dépôt WITHOUT a point and a dépôt principal with one → the dépôt principal | FAIL | scope.service.ts:146 doc: "the one dépôt he operates in when it has a point, else the dépôt principal when it has one, else null" | start: expected {"lat":36.7701,"lng":3.0552}, got null |
| A9 RouteDto.start — the dépôt of the route's seller (sellerDepotPoint) | a deleted dépôt is never the start; another tenant's dépôt principal is never the start | PASS |  |  |
| A9 RouteDto.start — the dépôt of the route's seller (sellerDepotPoint) | a seller reads `start` of his own route; GET /routes (the list) carries no start and no stops | PASS |  |  |