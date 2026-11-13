# test-35/perf-server

Total 18 · PASS 10 · FAIL 5 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| general | does the API compress its answers itself? | INFO |  | Content-Encoding without asking for one: none (Vercel compresses at the edge) |
| C1 the SQL of /clients/map and /clients/nearby | no N+1: a request runs a fixed, small number of statements whatever the number of points | PASS |  |  |
| C1 the SQL of /clients/map and /clients/nearby | map-50k-box: the lat/lng box is served by clients_tenant_geo_idx for the API's role | FAIL |  | not used as erp_app: 11.436 ms and 4787 buffers; as the owner it is used: 6.581 ms and 1323 buffers (artifacts/test-35/perf-explain.md, "map-50k-box") |
| C1 the SQL of /clients/map and /clients/nearby | map-50k-box-small: the lat/lng box is served by clients_tenant_geo_idx for the API's role | FAIL |  | not used as erp_app: 10.368 ms and 1312 buffers; as the owner it is used: 0.092 ms and 38 buffers (artifacts/test-35/perf-explain.md, "map-50k-box-small") |
| C1 the SQL of /clients/map and /clients/nearby | nearby-5k: the lat/lng box is served by clients_tenant_geo_idx for the API's role | FAIL |  | not used as erp_app: 3.054 ms and 347 buffers; as the owner it is used: 0.767 ms and 363 buffers (artifacts/test-35/perf-explain.md, "nearby-5k") |
| C1 the SQL of /clients/map and /clients/nearby | nearby-50k: the lat/lng box is served by clients_tenant_geo_idx for the API's role | FAIL |  | not used as erp_app: 12.85 ms and 3616 buffers; as the owner it is used: 7.133 ms and 3233 buffers (artifacts/test-35/perf-explain.md, "nearby-50k") |
| C1 the SQL of /clients/map and /clients/nearby | nearby-50k-wide: the lat/lng box is served by clients_tenant_geo_idx for the API's role | FAIL |  | not used as erp_app: 51.442 ms and 31624 buffers; as the owner it is used: 78.251 ms and 1731 buffers (artifacts/test-35/perf-explain.md, "nearby-50k-wide") |
| C1 the SQL of /clients/map and /clients/nearby | the unboxed map (first load) cannot use the geo index: it reads the tenant's clients by name | INFO |  | map-5k: slowest statement 10.001 ms; map-50k: 9.362 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-5k: p95 under 400 ms (local floor) | PASS |  | p50 20.1 ms, p95 29.9 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k: p95 under 400 ms (local floor) | PASS |  | p50 15.4 ms, p95 18.4 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-seller: p95 under 400 ms (local floor) | PASS |  | p50 36.8 ms, p95 41.4 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-debt: p95 under 400 ms (local floor) | PASS |  | p50 61.2 ms, p95 66.1 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-search: p95 under 400 ms (local floor) | PASS |  | p50 37.7 ms, p95 41.2 ms, 2000 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | map-50k-box: p95 under 400 ms (local floor) | PASS |  | p50 20.6 ms, p95 25.2 ms, 1549 points |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | nearby-5k: p95 under 400 ms | PASS |  | p50 6.8 ms, p95 10.9 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | nearby-50k: p95 under 400 ms | PASS |  | p50 21.9 ms, p95 22.7 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | nearby-50k-wide: p95 under 400 ms | PASS |  | p50 59.2 ms, p95 62.8 ms |
| C2 the budget of the spec: /clients/map with 2 000 points under 400 ms | size of /clients/map with 2 000 points | INFO |  | 514 kB raw, 99 kB gzip (263 bytes a point) |