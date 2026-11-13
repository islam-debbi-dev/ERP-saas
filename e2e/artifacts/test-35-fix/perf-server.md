# test-35/perf-server

Total 18 · PASS 15 · FAIL 0 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| general | does the API compress its answers itself? | INFO |  | Content-Encoding without asking for one: none (Vercel compresses at the edge) |
| C1 the SQL of /clients/map and /clients/nearby | no N+1: a request runs a fixed, small number of statements whatever the number of points | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | map-50k-box: the lat/lng box is served by clients_tenant_geo_idx for the API's role | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | map-50k-box-small: the lat/lng box is served by clients_tenant_geo_idx for the API's role | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | nearby-5k: the lat/lng box is served by clients_tenant_geo_idx for the API's role | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | nearby-50k: the lat/lng box is served by clients_tenant_geo_idx for the API's role | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | nearby-50k-wide: the lat/lng box is served by clients_tenant_geo_idx for the API's role | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | the unboxed map (first load) cannot use the geo index: it reads the tenant's clients by name | INFO |  | map-5k: slowest statement 9.653 ms; map-50k: 8.452 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-5k: p95 under 400 ms (local floor) | PASS |  | p50 19.8 ms, p95 24 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k: p95 under 400 ms (local floor) | PASS |  | p50 14.7 ms, p95 17.7 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-seller: p95 under 400 ms (local floor) | PASS |  | p50 33.9 ms, p95 43.3 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-debt: p95 under 400 ms (local floor) | PASS |  | p50 59 ms, p95 71.8 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-search: p95 under 400 ms (local floor) | PASS |  | p50 42.6 ms, p95 67.1 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-box: p95 under 400 ms (local floor) | PASS |  | p50 14.1 ms, p95 16.7 ms, 1549 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | nearby-5k: p95 under 400 ms | PASS |  | p50 7.2 ms, p95 13.4 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | nearby-50k: p95 under 400 ms | PASS |  | p50 14.3 ms, p95 15.8 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | nearby-50k-wide: p95 under 400 ms | PASS |  | p50 97.4 ms, p95 101 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | size of /clients/map with 2 000 points | INFO |  | 514 kB raw, 99 kB gzip (263 bytes a point) |