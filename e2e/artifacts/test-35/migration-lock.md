# test-35/migration-lock

Total 5 · PASS 3 · FAIL 0 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| E1 the index migration on a live clients table | the plain CREATE INDEX takes a SHARE lock: writes wait for the whole build, reads do not | PASS |  |  |
| E1 the index migration on a live clients table | on 50 000 rows the writes are blocked for less than one second | PASS |  | build 45 ms, worst write 45 ms (medians of 3) |
| E1 the index migration on a live clients table | on 145000 rows | INFO |  | build 126 ms, worst write 120 ms |
| E1 the index migration on a live clients table | with CONCURRENTLY, for comparison | INFO |  | build 152 ms, worst write 28 ms, lock modes AccessShareLock, RowExclusiveLock, ShareUpdateExclusiveLock |
| E1 the index migration on a live clients table | the index is back exactly as the migration made it | PASS |  |  |