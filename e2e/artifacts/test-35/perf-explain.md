# EXPLAIN (ANALYZE, BUFFERS) of the SQL the API ran

Captured from the Postgres log (`log_statement = all` for role erp_app), parameters inlined, run as erp_app with `app.tenant_id` set (row-level security applies).

## map-5k — /clients/map, 5 000 clients, owner, no filter (2 000 points, truncated)

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Aggregate  (cost=3991.82..3991.83 rows=1 width=8) (actual time=0.907..0.907 rows=1 loops=1)
  Buffers: shared hit=132
  ->  Bitmap Heap Scan on clients c  (cost=58.88..3991.73 rows=36 width=0) (actual time=0.073..0.879 rows=500 loops=1)
        Recheck Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
        Rows Removed by Filter: 4500
        Heap Blocks: exact=126
        Buffers: shared hit=132
        ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..58.87 rows=5143 width=0) (actual time=0.061..0.061 rows=5000 loops=1)
              Index Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
              Buffers: shared hit=6
Planning Time: 0.062 ms
Execution Time: 0.930 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=3904.14..3904.15 rows=1 width=8) (actual time=0.715..0.715 rows=1 loops=1)
  Buffers: shared hit=132
  ->  Bitmap Heap Scan on clients c  (cost=59.09..3901.94 rows=883 width=0) (actual time=0.066..0.689 rows=500 loops=1)
        Recheck Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)))
        Rows Removed by Filter: 4500
        Heap Blocks: exact=126
        Buffers: shared hit=132
        ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..58.87 rows=5143 width=0) (actual time=0.056..0.056 rows=5000 loops=1)
              Index Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
              Buffers: shared hit=6
Planning Time: 0.040 ms
Execution Time: 0.732 ms
```

## map-5k — /clients/map, 5 000 clients, owner, no filter (2 000 points, truncated)

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL 
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=4955.04..4955.43 rows=153 width=143) (actual time=9.693..9.874 rows=2001 loops=1)
  Buffers: shared hit=9232
  ->  Sort  (cost=4955.04..4955.43 rows=153 width=143) (actual time=9.693..9.764 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Sort Method: top-N heapsort  Memory: 557kB
        Buffers: shared hit=9232
        ->  Nested Loop Left Join  (cost=59.19..4949.49 rows=153 width=143) (actual time=0.072..5.649 rows=4050 loops=1)
              Buffers: shared hit=9232
              ->  Bitmap Heap Scan on clients c  (cost=58.91..3991.76 rows=153 width=115) (actual time=0.066..2.143 rows=4050 loops=1)
                    Recheck Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
                    Rows Removed by Filter: 950
                    Heap Blocks: exact=126
                    Buffers: shared hit=132
                    ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..58.87 rows=5143 width=0) (actual time=0.054..0.054 rows=5000 loops=1)
                          Index Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
                          Buffers: shared hit=6
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..6.26 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=4050)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=9100
Planning:
  Buffers: shared hit=14
Planning Time: 0.169 ms
Execution Time: 10.001 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=4882.14..4887.15 rows=2001 width=143) (actual time=9.145..9.318 rows=2001 loops=1)
  Buffers: shared hit=462
  ->  Sort  (cost=4882.14..4891.66 rows=3805 width=143) (actual time=9.145..9.212 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Sort Method: top-N heapsort  Memory: 572kB
        Buffers: shared hit=462
        ->  Hash Right Join  (cost=3950.23..4655.87 rows=3805 width=143) (actual time=2.624..5.197 rows=4050 loops=1)
              Hash Cond: (b."clientId" = c.id)
              Buffers: shared hit=462
              ->  Seq Scan on client_balances b  (cost=0.00..620.00 rows=29000 width=21) (actual time=0.001..1.174 rows=29000 loops=1)
                    Buffers: shared hit=330
              ->  Hash  (cost=3902.67..3902.67 rows=3805 width=115) (actual time=1.487..1.487 rows=4050 loops=1)
                    Buckets: 4096  Batches: 1  Memory Usage: 533kB
                    Buffers: shared hit=132
                    ->  Bitmap Heap Scan on clients c  (cost=59.82..3902.67 rows=3805 width=115) (actual time=0.062..0.826 rows=4050 loops=1)
                          Recheck Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL))
                          Rows Removed by Filter: 950
                          Heap Blocks: exact=126
                          Buffers: shared hit=132
                          ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..58.87 rows=5143 width=0) (actual time=0.052..0.052 rows=5000 loops=1)
                                Index Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
                                Buffers: shared hit=6
Planning:
  Buffers: shared hit=14
Planning Time: 0.110 ms
Execution Time: 9.447 ms
```

## map-50k — /clients/map, 50 000 clients, owner, no filter (2 000 points, truncated)

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Aggregate  (cost=5643.65..5643.66 rows=1 width=8) (actual time=9.329..9.329 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=540.27..5636.17 rows=2992 width=0) (actual time=0.711..9.071 rows=5000 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
        Rows Removed by Filter: 45000
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.614..0.614 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.092 ms
Execution Time: 9.362 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=4783.52..4783.53 rows=1 width=8) (actual time=7.144..7.145 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=541.67..4762.04 rows=8592 width=0) (actual time=0.673..6.921 rows=5000 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)))
        Rows Removed by Filter: 45000
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.579..0.579 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.064 ms
Execution Time: 7.173 ms
```

## map-50k — /clients/map, 50 000 clients, owner, no filter (2 000 points, truncated)

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL 
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=3.02..3534.79 rows=2001 width=143) (actual time=0.076..3.698 rows=2001 loops=1)
  Buffers: shared hit=5054
  ->  Incremental Sort  (cost=3.02..22759.22 rows=12893 width=143) (actual time=0.076..3.586 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Presorted Key: c.name
        Full-sort Groups: 63  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
        Buffers: shared hit=5054
        ->  Nested Loop Left Join  (cost=0.71..22291.35 rows=12893 width=143) (actual time=0.012..3.040 rows=2002 loops=1)
              Buffers: shared hit=5054
              ->  Index Scan using "clients_tenantId_name_idx" on clients c  (cost=0.42..16185.13 rows=12893 width=115) (actual time=0.007..1.205 rows=2002 loops=1)
                    Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
                    Rows Removed by Filter: 508
                    Buffers: shared hit=528
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..0.47 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=2002)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=4526
Planning:
  Buffers: shared hit=14
Planning Time: 0.140 ms
Execution Time: 3.783 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=2.39..1603.39 rows=2001 width=143) (actual time=0.067..2.954 rows=2001 loops=1)
  Buffers: shared hit=5054
  ->  Incremental Sort  (cost=2.39..29618.83 rows=37016 width=143) (actual time=0.067..2.833 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Presorted Key: c.name
        Full-sort Groups: 63  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
        Buffers: shared hit=5054
        ->  Nested Loop Left Join  (cost=0.71..28608.02 rows=37016 width=143) (actual time=0.012..2.229 rows=2002 loops=1)
              Buffers: shared hit=5054
              ->  Index Scan using "clients_tenantId_name_idx" on clients c  (cost=0.42..15309.60 rows=37016 width=115) (actual time=0.007..0.526 rows=2002 loops=1)
                    Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL))
                    Rows Removed by Filter: 508
                    Buffers: shared hit=528
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..0.36 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=2002)
                    Index Cond: ("clientId" = c.id)
                    Buffers: shared hit=4526
Planning:
  Buffers: shared hit=14
Planning Time: 0.123 ms
Execution Time: 3.036 ms
```

## map-50k-box — /clients/map, 50 000 clients, a city-sized box

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Aggregate  (cost=5643.65..5643.66 rows=1 width=8) (actual time=9.185..9.185 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=540.27..5636.17 rows=2992 width=0) (actual time=0.700..8.933 rows=5000 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
        Rows Removed by Filter: 45000
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.602..0.602 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.091 ms
Execution Time: 9.220 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=4783.52..4783.53 rows=1 width=8) (actual time=7.301..7.302 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=541.67..4762.04 rows=8592 width=0) (actual time=0.677..7.079 rows=5000 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)))
        Rows Removed by Filter: 45000
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.588..0.588 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.067 ms
Execution Time: 7.329 ms
```

## map-50k-box — /clients/map, 50 000 clients, a city-sized box

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.lat BETWEEN '36.7'::numeric AND '36.8'::numeric
            AND c.lng BETWEEN '3'::numeric AND '3.12'::numeric
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=5976.79..5976.80 rows=1 width=143) (actual time=11.133..11.343 rows=1549 loops=1)
  Buffers: shared hit=4787
  ->  Sort  (cost=5976.79..5976.80 rows=1 width=143) (actual time=11.132..11.260 rows=1549 loops=1)
        Sort Key: c.name, c.id
        Sort Method: quicksort  Memory: 276kB
        Buffers: shared hit=4787
        ->  Nested Loop Left Join  (cost=1539.81..5976.78 rows=1 width=143) (actual time=1.041..9.863 rows=1549 loops=1)
              Buffers: shared hit=4787
              ->  Gather  (cost=1539.52..5968.45 rows=1 width=115) (actual time=1.028..8.127 rows=1549 loops=1)
                    Workers Planned: 2
                    Workers Launched: 2
                    Buffers: shared hit=1291
                    ->  Parallel Bitmap Heap Scan on clients c  (cost=539.52..4968.35 rows=1 width=115) (actual time=0.323..7.787 rows=516 loops=3)
                          Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (lat >= 36.7) AND (lat <= 36.8) AND (lng >= '3'::numeric) AND (lng <= 3.12))
                          Rows Removed by Filter: 16150
                          Heap Blocks: exact=393
                          Buffers: shared hit=1291
                          ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.733..0.733 rows=50000 loops=1)
                                Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                                Buffers: shared hit=41
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.32 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=1549)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=3496
Planning:
  Buffers: shared hit=14
Planning Time: 0.187 ms
Execution Time: 11.436 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=2177.63..2178.52 rows=357 width=143) (actual time=6.356..6.489 rows=1549 loops=1)
  Buffers: shared hit=1323
  ->  Sort  (cost=2177.63..2178.52 rows=357 width=143) (actual time=6.356..6.408 rows=1549 loops=1)
        Sort Key: c.name, c.id
        Sort Method: quicksort  Memory: 276kB
        Buffers: shared hit=1323
        ->  Hash Right Join  (cost=1465.48..2162.49 rows=357 width=143) (actual time=1.693..5.140 rows=1549 loops=1)
              Hash Cond: (b."clientId" = c.id)
              Buffers: shared hit=1323
              ->  Seq Scan on client_balances b  (cost=0.00..620.00 rows=29000 width=21) (actual time=0.002..1.220 rows=29000 loops=1)
                    Buffers: shared hit=330
              ->  Hash  (cost=1461.01..1461.01 rows=357 width=115) (actual time=1.683..1.684 rows=1549 loops=1)
                    Buckets: 2048 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 213kB
                    Buffers: shared hit=993
                    ->  Bitmap Heap Scan on clients c  (cost=264.43..1461.01 rows=357 width=115) (actual time=0.675..1.422 rows=1549 loops=1)
                          Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.7) AND (lat <= 36.8) AND (lng IS NOT NULL) AND (lng >= '3'::numeric) AND (lng <= 3.12) AND ("deletedAt" IS NULL))
                          Filter: active
                          Rows Removed by Filter: 98
                          Heap Blocks: exact=945
                          Buffers: shared hit=993
                          ->  Bitmap Index Scan on clients_tenant_geo_idx  (cost=0.00..264.34 rows=417 width=0) (actual time=0.606..0.606 rows=1647 loops=1)
                                Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.7) AND (lat <= 36.8) AND (lng IS NOT NULL) AND (lng >= '3'::numeric) AND (lng <= 3.12))
                                Buffers: shared hit=48
Planning:
  Buffers: shared hit=14
Planning Time: 0.190 ms
Execution Time: 6.581 ms
```

## map-50k-box-small — /clients/map, 50 000 clients, a 1 km box

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Aggregate  (cost=5643.65..5643.66 rows=1 width=8) (actual time=9.935..9.936 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=540.27..5636.17 rows=2992 width=0) (actual time=0.705..9.668 rows=5000 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
        Rows Removed by Filter: 45000
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.599..0.599 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.094 ms
Execution Time: 9.977 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=4783.52..4783.53 rows=1 width=8) (actual time=7.168..7.168 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=541.67..4762.04 rows=8592 width=0) (actual time=0.655..6.944 rows=5000 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)))
        Rows Removed by Filter: 45000
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.563..0.563 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.071 ms
Execution Time: 7.200 ms
```

## map-50k-box-small — /clients/map, 50 000 clients, a 1 km box

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.lat BETWEEN '36.75'::numeric AND '36.76'::numeric
            AND c.lng BETWEEN '3.05'::numeric AND '3.06'::numeric
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=5976.79..5976.80 rows=1 width=143) (actual time=9.198..10.333 rows=9 loops=1)
  Buffers: shared hit=1312
  ->  Sort  (cost=5976.79..5976.80 rows=1 width=143) (actual time=9.197..10.332 rows=9 loops=1)
        Sort Key: c.name, c.id
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=1312
        ->  Nested Loop Left Join  (cost=1539.81..5976.78 rows=1 width=143) (actual time=7.715..10.321 rows=9 loops=1)
              Buffers: shared hit=1312
              ->  Gather  (cost=1539.52..5968.45 rows=1 width=115) (actual time=7.701..10.284 rows=9 loops=1)
                    Workers Planned: 2
                    Workers Launched: 2
                    Buffers: shared hit=1291
                    ->  Parallel Bitmap Heap Scan on clients c  (cost=539.52..4968.35 rows=1 width=115) (actual time=3.203..7.659 rows=3 loops=3)
                          Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (lat >= 36.75) AND (lat <= 36.76) AND (lng >= 3.05) AND (lng <= 3.06))
                          Rows Removed by Filter: 16664
                          Heap Blocks: exact=465
                          Buffers: shared hit=1291
                          ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.837..0.837 rows=50000 loops=1)
                                Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                                Buffers: shared hit=41
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.32 rows=1 width=21) (actual time=0.003..0.003 rows=0 loops=9)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=21
Planning:
  Buffers: shared hit=14
Planning Time: 0.180 ms
Execution Time: 10.368 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=65.88..65.88 rows=3 width=143) (actual time=0.074..0.076 rows=9 loops=1)
  Buffers: shared hit=38
  ->  Sort  (cost=65.88..65.88 rows=3 width=143) (actual time=0.074..0.075 rows=9 loops=1)
        Sort Key: c.name, c.id
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=38
        ->  Nested Loop Left Join  (cost=0.70..65.85 rows=3 width=143) (actual time=0.027..0.068 rows=9 loops=1)
              Buffers: shared hit=38
              ->  Index Scan using clients_tenant_geo_idx on clients c  (cost=0.42..40.93 rows=3 width=115) (actual time=0.022..0.053 rows=9 loops=1)
                    Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.75) AND (lat <= 36.76) AND (lng IS NOT NULL) AND (lng >= 3.05) AND (lng <= 3.06))
                    Filter: active
                    Rows Removed by Filter: 1
                    Buffers: shared hit=17
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.30 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=9)
                    Index Cond: ("clientId" = c.id)
                    Buffers: shared hit=21
Planning:
  Buffers: shared hit=14
Planning Time: 0.131 ms
Execution Time: 0.092 ms
```

## map-50k-debt — /clients/map, 50 000 clients, hasDebt

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND COALESCE(b.balance, 0) > 0 AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Aggregate  (cost=6830.06..6830.07 rows=1 width=8) (actual time=20.974..20.976 rows=1 loops=1)
  Buffers: shared hit=1621
  ->  Hash Right Join  (cost=5673.57..6827.57 rows=997 width=0) (actual time=20.972..20.973 rows=0 loops=1)
        Hash Cond: (b."clientId" = c.id)
        Filter: (COALESCE(b.balance, '0'::numeric) > '0'::numeric)
        Rows Removed by Filter: 5000
        Buffers: shared hit=1621
        ->  Seq Scan on client_balances b  (cost=0.00..1127.50 rows=10095 width=21) (actual time=0.008..10.692 rows=10000 loops=1)
              Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
              Rows Removed by Filter: 19000
              Buffers: shared hit=330
        ->  Hash  (cost=5636.17..5636.17 rows=2992 width=16) (actual time=9.443..9.444 rows=5000 loops=1)
              Buckets: 8192 (originally 4096)  Batches: 1 (originally 1)  Memory Usage: 299kB
              Buffers: shared hit=1291
              ->  Bitmap Heap Scan on clients c  (cost=540.27..5636.17 rows=2992 width=16) (actual time=0.677..8.976 rows=5000 loops=1)
                    Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
                    Rows Removed by Filter: 45000
                    Heap Blocks: exact=1250
                    Buffers: shared hit=1291
                    ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.583..0.583 rows=50000 loops=1)
                          Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Buffers: shared hit=41
Planning:
  Buffers: shared hit=14
Planning Time: 0.177 ms
Execution Time: 21.040 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=5572.73..5572.74 rows=1 width=8) (actual time=12.686..12.688 rows=1 loops=1)
  Buffers: shared hit=1621
  ->  Hash Right Join  (cost=4869.44..5565.57 rows=2864 width=0) (actual time=12.683..12.685 rows=0 loops=1)
        Hash Cond: (b."clientId" = c.id)
        Filter: (COALESCE(b.balance, '0'::numeric) > '0'::numeric)
        Rows Removed by Filter: 5000
        Buffers: shared hit=1621
        ->  Seq Scan on client_balances b  (cost=0.00..620.00 rows=29000 width=21) (actual time=0.009..1.329 rows=29000 loops=1)
              Buffers: shared hit=330
        ->  Hash  (cost=4762.04..4762.04 rows=8592 width=16) (actual time=8.905..8.906 rows=5000 loops=1)
              Buckets: 16384  Batches: 1  Memory Usage: 363kB
              Buffers: shared hit=1291
              ->  Bitmap Heap Scan on clients c  (cost=541.67..4762.04 rows=8592 width=16) (actual time=0.792..8.156 rows=5000 loops=1)
                    Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)))
                    Rows Removed by Filter: 45000
                    Heap Blocks: exact=1250
                    Buffers: shared hit=1291
                    ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.675..0.675 rows=50000 loops=1)
                          Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Buffers: shared hit=41
Planning:
  Buffers: shared hit=14
Planning Time: 0.181 ms
Execution Time: 12.752 ms
```

## map-50k-debt — /clients/map, 50 000 clients, hasDebt

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND COALESCE(b.balance, 0) > 0 AND c.lat IS NOT NULL AND c.lng IS NOT NULL 
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=7194.08..7199.08 rows=2001 width=143) (actual time=45.418..45.600 rows=2001 loops=1)
  Buffers: shared hit=1621
  ->  Sort  (cost=7194.08..7204.83 rows=4298 width=143) (actual time=45.417..45.490 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Sort Method: top-N heapsort  Memory: 556kB
        Buffers: shared hit=1621
        ->  Hash Left Join  (cost=1796.43..6936.92 rows=4298 width=143) (actual time=13.263..38.827 rows=10000 loops=1)
              Hash Cond: (c.id = b."clientId")
              Filter: (COALESCE(b.balance, '0'::numeric) > '0'::numeric)
              Rows Removed by Filter: 30500
              Buffers: shared hit=1621
              ->  Bitmap Heap Scan on clients c  (cost=542.74..5638.64 rows=12893 width=115) (actual time=0.775..21.419 rows=40500 loops=1)
                    Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
                    Rows Removed by Filter: 9500
                    Heap Blocks: exact=1250
                    Buffers: shared hit=1291
                    ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.664..0.665 rows=50000 loops=1)
                          Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Buffers: shared hit=41
              ->  Hash  (cost=1127.50..1127.50 rows=10095 width=21) (actual time=12.467..12.467 rows=10000 loops=1)
                    Buckets: 16384  Batches: 1  Memory Usage: 653kB
                    Buffers: shared hit=330
                    ->  Seq Scan on client_balances b  (cost=0.00..1127.50 rows=10095 width=21) (actual time=0.008..11.348 rows=10000 loops=1)
                          Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                          Rows Removed by Filter: 19000
                          Buffers: shared hit=330
Planning:
  Buffers: shared hit=14
Planning Time: 0.214 ms
Execution Time: 45.768 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=3.07..4796.97 rows=2001 width=143) (actual time=0.177..8.392 rows=2001 loops=1)
  Buffers: shared hit=20078
  ->  Incremental Sort  (cost=3.07..29564.29 rows=12339 width=143) (actual time=0.177..8.288 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Presorted Key: c.name
        Full-sort Groups: 63  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
        Buffers: shared hit=20078
        ->  Nested Loop Left Join  (cost=0.71..29009.03 rows=12339 width=143) (actual time=0.014..7.782 rows=2002 loops=1)
              Filter: (COALESCE(b.balance, '0'::numeric) > '0'::numeric)
              Rows Removed by Filter: 5993
              Buffers: shared hit=20078
              ->  Index Scan using "clients_tenantId_name_idx" on clients c  (cost=0.42..15309.60 rows=37016 width=115) (actual time=0.007..2.110 rows=7995 loops=1)
                    Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL))
                    Rows Removed by Filter: 1888
                    Buffers: shared hit=2086
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..0.36 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=7995)
                    Index Cond: ("clientId" = c.id)
                    Buffers: shared hit=17992
Planning:
  Buffers: shared hit=14
Planning Time: 0.135 ms
Execution Time: 8.469 ms
```

## map-50k-search — /clients/map, 50 000 clients, search "caf"

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND (c.code ILIKE '%caf%' OR c.name ILIKE '%caf%' OR c.phone ILIKE '%caf%' OR c.phone2 ILIKE '%caf%') AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Finalize Aggregate  (cost=5969.01..5969.02 rows=1 width=8) (actual time=6.507..7.675 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Gather  (cost=5968.80..5969.01 rows=2 width=8) (actual time=6.405..7.672 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=1291
        ->  Partial Aggregate  (cost=4968.80..4968.81 rows=1 width=8) (actual time=4.819..4.820 rows=1 loops=3)
              Buffers: shared hit=1291
              ->  Parallel Bitmap Heap Scan on clients c  (cost=539.61..4968.44 rows=144 width=0) (actual time=0.335..4.807 rows=223 loops=3)
                    Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (((code)::text ~~* '%caf%'::text) OR ((name)::text ~~* '%caf%'::text) OR ((phone)::text ~~* '%caf%'::text) OR ((phone2)::text ~~* '%caf%'::text)))
                    Rows Removed by Filter: 16443
                    Heap Blocks: exact=512
                    Buffers: shared hit=1291
                    ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.793..0.793 rows=50000 loops=1)
                          Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Buffers: shared hit=41
Planning Time: 0.123 ms
Execution Time: 7.713 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=5263.07..5263.08 rows=1 width=8) (actual time=10.832..10.832 rows=1 loops=1)
  Buffers: shared hit=1291
  ->  Bitmap Heap Scan on clients c  (cost=539.78..5260.46 rows=1046 width=0) (actual time=0.689..10.799 rows=670 loops=1)
        Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (((code)::text ~~* '%caf%'::text) OR ((name)::text ~~* '%caf%'::text) OR ((phone)::text ~~* '%caf%'::text) OR ((phone2)::text ~~* '%caf%'::text)))
        Rows Removed by Filter: 49330
        Heap Blocks: exact=1250
        Buffers: shared hit=1291
        ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.578..0.579 rows=50000 loops=1)
              Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
              Buffers: shared hit=41
Planning Time: 0.218 ms
Execution Time: 10.859 ms
```

## map-50k-search — /clients/map, 50 000 clients, search "caf"

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND (c.code ILIKE '%caf%' OR c.name ILIKE '%caf%' OR c.phone ILIKE '%caf%' OR c.phone2 ILIKE '%caf%') AND c.lat IS NOT NULL AND c.lng IS NOT NULL 
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=6996.74..7141.19 rows=1238 width=143) (actual time=22.332..24.184 rows=2001 loops=1)
  Buffers: shared hit=12445
  ->  Gather Merge  (cost=6996.74..7141.19 rows=1238 width=143) (actual time=22.331..24.074 rows=2001 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=12445
        ->  Sort  (cost=5996.72..5998.27 rows=619 width=143) (actual time=20.787..20.820 rows=968 loops=3)
              Sort Key: c.name, c.id
              Sort Method: quicksort  Memory: 281kB
              Buffers: shared hit=12445
              Worker 0:  Sort Method: quicksort  Memory: 262kB
              Worker 1:  Sort Method: quicksort  Memory: 271kB
              ->  Nested Loop Left Join  (cost=540.18..5968.02 rows=619 width=143) (actual time=0.337..20.335 rows=1664 loops=3)
                    Buffers: shared hit=12415
                    ->  Parallel Bitmap Heap Scan on clients c  (cost=539.89..4968.72 rows=619 width=115) (actual time=0.318..18.551 rows=1664 loops=3)
                          Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (((code)::text ~~* '%caf%'::text) OR ((name)::text ~~* '%caf%'::text) OR ((phone)::text ~~* '%caf%'::text) OR ((phone2)::text ~~* '%caf%'::text)))
                          Rows Removed by Filter: 15003
                          Heap Blocks: exact=438
                          Buffers: shared hit=1291
                          ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.758..0.759 rows=50000 loops=1)
                                Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                                Buffers: shared hit=41
                    ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..1.61 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=4991)
                          Index Cond: ("clientId" = c.id)
                          Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                          Buffers: shared hit=11124
Planning:
  Buffers: shared hit=14
Planning Time: 0.193 ms
Execution Time: 24.293 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=6294.57..6299.57 rows=2001 width=143) (actual time=48.800..48.972 rows=2001 loops=1)
  Buffers: shared hit=1621
  ->  Sort  (cost=6294.57..6305.83 rows=4505 width=143) (actual time=48.800..48.866 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Sort Method: top-N heapsort  Memory: 553kB
        Buffers: shared hit=1621
        ->  Hash Right Join  (cost=5317.63..6025.02 rows=4505 width=143) (actual time=39.667..43.504 rows=4991 loops=1)
              Hash Cond: (b."clientId" = c.id)
              Buffers: shared hit=1621
              ->  Seq Scan on client_balances b  (cost=0.00..620.00 rows=29000 width=21) (actual time=0.004..1.215 rows=29000 loops=1)
                    Buffers: shared hit=330
              ->  Hash  (cost=5261.32..5261.32 rows=4505 width=115) (actual time=39.652..39.652 rows=4991 loops=1)
                    Buckets: 8192  Batches: 1  Memory Usage: 658kB
                    Buffers: shared hit=1291
                    ->  Bitmap Heap Scan on clients c  (cost=540.65..5261.32 rows=4505 width=115) (actual time=0.683..38.832 rows=4991 loops=1)
                          Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (((code)::text ~~* '%caf%'::text) OR ((name)::text ~~* '%caf%'::text) OR ((phone)::text ~~* '%caf%'::text) OR ((phone2)::text ~~* '%caf%'::text)))
                          Rows Removed by Filter: 45009
                          Heap Blocks: exact=1250
                          Buffers: shared hit=1291
                          ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.584..0.584 rows=50000 loops=1)
                                Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                                Buffers: shared hit=41
Planning:
  Buffers: shared hit=14
Planning Time: 0.306 ms
Execution Time: 49.140 ms
```

## map-50k-seller — /clients/map, 50 000 clients, a seller (ASSIGNED_ONLY, one client in eight)

```sql
SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND c."assignedSellerId" = ANY('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[]) AND c.active AND (c.lat IS NULL OR c.lng IS NULL)
```

As erp_app (row-level security on), what the API gets:

```
Aggregate  (cost=3328.06..3328.07 rows=1 width=8) (actual time=1.656..1.656 rows=1 loops=1)
  Buffers: shared hit=1256
  ->  Bitmap Heap Scan on clients c  (cost=29.49..3327.74 rows=127 width=0) (actual time=1.655..1.655 rows=0 loops=1)
        Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
        Rows Removed by Filter: 6250
        Heap Blocks: exact=1250
        Buffers: shared hit=1256
        ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..29.46 rows=2116 width=0) (actual time=0.146..0.146 rows=6250 loops=1)
              Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
              Buffers: shared hit=6
Planning Time: 0.093 ms
Execution Time: 1.686 ms
```

As erp, the table owner (no row-level security):

```
Aggregate  (cost=3291.68..3291.69 rows=1 width=8) (actual time=2.325..2.326 rows=1 loops=1)
  Buffers: shared hit=1256
  ->  Bitmap Heap Scan on clients c  (cost=29.55..3290.77 rows=363 width=0) (actual time=2.323..2.323 rows=0 loops=1)
        Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
        Filter: (("deletedAt" IS NULL) AND active AND ((lat IS NULL) OR (lng IS NULL)))
        Rows Removed by Filter: 6250
        Heap Blocks: exact=1250
        Buffers: shared hit=1256
        ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..29.46 rows=2116 width=0) (actual time=0.150..0.151 rows=6250 loops=1)
              Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
              Buffers: shared hit=6
Planning Time: 0.079 ms
Execution Time: 2.366 ms
```

## map-50k-seller — /clients/map, 50 000 clients, a seller (ASSIGNED_ONLY, one client in eight)

```sql
SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND c."assignedSellerId" = ANY('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[]) AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL 
        ORDER BY c.name, c.id
        LIMIT '2001'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=4514.79..4516.15 rows=545 width=143) (actual time=22.280..22.474 rows=2001 loops=1)
  Buffers: shared hit=1586
  ->  Sort  (cost=4514.79..4516.15 rows=545 width=143) (actual time=22.280..22.348 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Sort Method: top-N heapsort  Memory: 678kB
        Buffers: shared hit=1586
        ->  Hash Right Join  (cost=3334.66..4490.02 rows=545 width=143) (actual time=4.954..17.015 rows=6000 loops=1)
              Hash Cond: (b."clientId" = c.id)
              Buffers: shared hit=1586
              ->  Seq Scan on client_balances b  (cost=0.00..1127.50 rows=10095 width=21) (actual time=0.004..10.609 rows=10000 loops=1)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Rows Removed by Filter: 19000
                    Buffers: shared hit=330
              ->  Hash  (cost=3327.85..3327.85 rows=545 width=115) (actual time=4.944..4.945 rows=6000 loops=1)
                    Buckets: 8192 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 873kB
                    Buffers: shared hit=1256
                    ->  Bitmap Heap Scan on clients c  (cost=29.59..3327.85 rows=545 width=115) (actual time=0.253..3.914 rows=6000 loops=1)
                          Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)))
                          Rows Removed by Filter: 250
                          Heap Blocks: exact=1250
                          Buffers: shared hit=1256
                          ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..29.46 rows=2116 width=0) (actual time=0.149..0.150 rows=6250 loops=1)
                                Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
                                Buffers: shared hit=6
Planning:
  Buffers: shared hit=14
Planning Time: 0.185 ms
Execution Time: 22.624 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=4093.79..4097.70 rows=1566 width=143) (actual time=12.254..12.429 rows=2001 loops=1)
  Buffers: shared hit=1586
  ->  Sort  (cost=4093.79..4097.70 rows=1566 width=143) (actual time=12.253..12.321 rows=2001 loops=1)
        Sort Key: c.name, c.id
        Sort Method: top-N heapsort  Memory: 678kB
        Buffers: shared hit=1586
        ->  Hash Right Join  (cost=3310.65..4010.69 rows=1566 width=143) (actual time=2.999..7.061 rows=6000 loops=1)
              Hash Cond: (b."clientId" = c.id)
              Buffers: shared hit=1586
              ->  Seq Scan on client_balances b  (cost=0.00..620.00 rows=29000 width=21) (actual time=0.002..1.268 rows=29000 loops=1)
                    Buffers: shared hit=330
              ->  Hash  (cost=3291.07..3291.07 rows=1566 width=115) (actual time=2.991..2.992 rows=6000 loops=1)
                    Buckets: 8192 (originally 2048)  Batches: 1 (originally 1)  Memory Usage: 873kB
                    Buffers: shared hit=1256
                    ->  Bitmap Heap Scan on clients c  (cost=29.85..3291.07 rows=1566 width=115) (actual time=0.233..1.968 rows=6000 loops=1)
                          Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL))
                          Rows Removed by Filter: 250
                          Heap Blocks: exact=1250
                          Buffers: shared hit=1256
                          ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..29.46 rows=2116 width=0) (actual time=0.142..0.142 rows=6250 loops=1)
                                Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND ("assignedSellerId" = ANY ('{8382a821-60ad-486a-83b3-0b194a33a2f7}'::uuid[])))
                                Buffers: shared hit=6
Planning:
  Buffers: shared hit=14
Planning Time: 0.138 ms
Execution Time: 12.578 ms
```

## nearby-5k — /clients/nearby, 5 000 clients, 5 km

```sql
SELECT * FROM (
        SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId",
          (2 * '6371008.8'::float8 * asin(least(1, sqrt(
            power(sin(radians(c.lat::float8 - '36.7538'::float8) / 2), 2)
            + cos(radians('36.7538'::float8)) * cos(radians(c.lat::float8))
              * power(sin(radians(c.lng::float8 - '3.0588'::float8) / 2), 2)
          )))) AS "distanceM"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          AND c.lat BETWEEN '36.70883398181377'::numeric AND '36.79876601818623'::numeric AND c.lng BETWEEN '3.0026447175411937'::numeric AND '3.1149552824588067'::numeric
      ) near
      WHERE near."distanceM" <= '5000'
      ORDER BY near."distanceM", near.name, near.id
      LIMIT '30'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=4347.28..4347.28 rows=1 width=151) (actual time=3.000..3.003 rows=30 loops=1)
  Buffers: shared hit=347
  ->  Sort  (cost=4347.28..4347.28 rows=1 width=151) (actual time=2.999..3.001 rows=30 loops=1)
        Sort Key: (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((c.lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((c.lat)::double precision))) * power(sin((radians(((c.lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision)))))))), c.name, c.id
        Sort Method: top-N heapsort  Memory: 34kB
        Buffers: shared hit=347
        ->  Nested Loop Left Join  (cost=59.16..4347.27 rows=1 width=151) (actual time=0.144..2.964 rows=98 loops=1)
              Buffers: shared hit=347
              ->  Bitmap Heap Scan on clients c  (cost=58.87..4338.87 rows=1 width=115) (actual time=0.133..2.641 rows=98 loops=1)
                    Recheck Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
                    Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (lat >= 36.70883398181377) AND (lat <= 36.79876601818623) AND (lng >= 3.0026447175411937) AND (lng <= 3.1149552824588067) AND (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((lat)::double precision))) * power(sin((radians(((lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision))))))) <= '5000'::double precision))
                    Rows Removed by Filter: 4902
                    Heap Blocks: exact=126
                    Buffers: shared hit=132
                    ->  Bitmap Index Scan on "clients_tenantId_assignedSellerId_idx"  (cost=0.00..58.87 rows=5143 width=0) (actual time=0.058..0.058 rows=5000 loops=1)
                          Index Cond: ("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid)
                          Buffers: shared hit=6
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.32 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=98)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=215
Planning:
  Buffers: shared hit=14
Planning Time: 0.218 ms
Execution Time: 3.054 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=232.45..232.48 rows=10 width=151) (actual time=0.741..0.744 rows=30 loops=1)
  Buffers: shared hit=363
  ->  Sort  (cost=232.45..232.48 rows=10 width=151) (actual time=0.740..0.742 rows=30 loops=1)
        Sort Key: (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((c.lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((c.lat)::double precision))) * power(sin((radians(((c.lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision)))))))), c.name, c.id
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=363
        ->  Nested Loop Left Join  (cost=0.70..232.29 rows=10 width=151) (actual time=0.037..0.712 rows=98 loops=1)
              Buffers: shared hit=363
              ->  Index Scan using clients_tenant_geo_idx on clients c  (cost=0.42..148.66 rows=10 width=115) (actual time=0.028..0.425 rows=98 loops=1)
                    Index Cond: (("tenantId" = '751e8762-b35e-4cee-8df6-c174fe32d827'::uuid) AND (lat >= 36.70883398181377) AND (lat <= 36.79876601818623) AND (lng IS NOT NULL) AND (lng >= 3.0026447175411937) AND (lng <= 3.1149552824588067))
                    Filter: (active AND (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((lat)::double precision))) * power(sin((radians(((lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision))))))) <= '5000'::double precision))
                    Rows Removed by Filter: 42
                    Buffers: shared hit=148
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.30 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=98)
                    Index Cond: ("clientId" = c.id)
                    Buffers: shared hit=215
Planning:
  Buffers: shared hit=14
Planning Time: 0.199 ms
Execution Time: 0.767 ms
```

## nearby-50k — /clients/nearby, 50 000 clients, 5 km

```sql
SELECT * FROM (
        SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId",
          (2 * '6371008.8'::float8 * asin(least(1, sqrt(
            power(sin(radians(c.lat::float8 - '36.7538'::float8) / 2), 2)
            + cos(radians('36.7538'::float8)) * cos(radians(c.lat::float8))
              * power(sin(radians(c.lng::float8 - '3.0588'::float8) / 2), 2)
          )))) AS "distanceM"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          AND c.lat BETWEEN '36.70883398181377'::numeric AND '36.79876601818623'::numeric AND c.lng BETWEEN '3.0026447175411937'::numeric AND '3.1149552824588067'::numeric
      ) near
      WHERE near."distanceM" <= '5000'
      ORDER BY near."distanceM", near.name, near.id
      LIMIT '30'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=7175.48..7175.49 rows=1 width=151) (actual time=12.435..12.802 rows=30 loops=1)
  Buffers: shared hit=3616
  ->  Sort  (cost=7175.48..7175.49 rows=1 width=151) (actual time=12.435..12.799 rows=30 loops=1)
        Sort Key: (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((c.lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((c.lat)::double precision))) * power(sin((radians(((c.lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision)))))))), c.name, c.id
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=3616
        ->  Nested Loop Left Join  (cost=1539.81..7175.47 rows=1 width=151) (actual time=1.079..12.549 rows=1031 loops=1)
              Buffers: shared hit=3616
              ->  Gather  (cost=1539.52..7167.09 rows=1 width=115) (actual time=1.064..8.741 rows=1031 loops=1)
                    Workers Planned: 2
                    Workers Launched: 2
                    Buffers: shared hit=1291
                    ->  Parallel Bitmap Heap Scan on clients c  (cost=539.52..6166.99 rows=1 width=115) (actual time=0.351..8.871 rows=344 loops=3)
                          Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (lat >= 36.70883398181377) AND (lat <= 36.79876601818623) AND (lng >= 3.0026447175411937) AND (lng <= 3.1149552824588067) AND (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((lat)::double precision))) * power(sin((radians(((lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision))))))) <= '5000'::double precision))
                          Rows Removed by Filter: 16323
                          Heap Blocks: exact=360
                          Buffers: shared hit=1291
                          ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.746..0.746 rows=50000 loops=1)
                                Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                                Buffers: shared hit=41
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.32 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=1031)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=2325
Planning:
  Buffers: shared hit=14
Planning Time: 0.259 ms
Execution Time: 12.850 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=1987.20..1987.27 rows=30 width=151) (actual time=7.103..7.106 rows=30 loops=1)
  Buffers: shared hit=3233
  ->  Sort  (cost=1987.20..1987.45 rows=100 width=151) (actual time=7.103..7.104 rows=30 loops=1)
        Sort Key: (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((c.lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((c.lat)::double precision))) * power(sin((radians(((c.lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision)))))))), c.name, c.id
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=3233
        ->  Nested Loop Left Join  (cost=238.99..1984.24 rows=100 width=151) (actual time=0.563..6.888 rows=1031 loops=1)
              Buffers: shared hit=3233
              ->  Bitmap Heap Scan on clients c  (cost=238.70..1299.99 rows=100 width=115) (actual time=0.554..4.094 rows=1031 loops=1)
                    Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.70883398181377) AND (lat <= 36.79876601818623) AND (lng IS NOT NULL) AND (lng >= 3.0026447175411937) AND (lng <= 3.1149552824588067) AND ("deletedAt" IS NULL))
                    Filter: (active AND (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((lat)::double precision))) * power(sin((radians(((lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision))))))) <= '5000'::double precision))
                    Rows Removed by Filter: 361
                    Heap Blocks: exact=865
                    Buffers: shared hit=908
                    ->  Bitmap Index Scan on clients_tenant_geo_idx  (cost=0.00..238.68 rows=351 width=0) (actual time=0.494..0.495 rows=1392 loops=1)
                          Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.70883398181377) AND (lat <= 36.79876601818623) AND (lng IS NOT NULL) AND (lng >= 3.0026447175411937) AND (lng <= 3.1149552824588067))
                          Buffers: shared hit=43
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..6.78 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=1031)
                    Index Cond: ("clientId" = c.id)
                    Buffers: shared hit=2325
Planning:
  Buffers: shared hit=14
Planning Time: 0.182 ms
Execution Time: 7.133 ms
```

## nearby-50k-wide — /clients/nearby, 50 000 clients, 50 km, 100 rows

```sql
SELECT * FROM (
        SELECT 
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId",
          (2 * '6371008.8'::float8 * asin(least(1, sqrt(
            power(sin(radians(c.lat::float8 - '36.7538'::float8) / 2), 2)
            + cos(radians('36.7538'::float8)) * cos(radians(c.lat::float8))
              * power(sin(radians(c.lng::float8 - '3.0588'::float8) / 2), 2)
          )))) AS "distanceM"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE c."tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid AND c."deletedAt" IS NULL AND TRUE AND c.active AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          AND c.lat BETWEEN '36.30413981813773'::numeric AND '37.20346018186227'::numeric AND c.lng BETWEEN '2.4942468726687776'::numeric AND '3.6233531273312227'::numeric
      ) near
      WHERE near."distanceM" <= '50000'
      ORDER BY near."distanceM", near.name, near.id
      LIMIT '100'
```

As erp_app (row-level security on), what the API gets:

```
Limit  (cost=7175.48..7175.49 rows=1 width=151) (actual time=51.308..51.396 rows=100 loops=1)
  Buffers: shared hit=31624
  ->  Sort  (cost=7175.48..7175.49 rows=1 width=151) (actual time=51.308..51.389 rows=100 loops=1)
        Sort Key: (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((c.lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((c.lat)::double precision))) * power(sin((radians(((c.lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision)))))))), c.name, c.id
        Sort Method: top-N heapsort  Memory: 50kB
        Buffers: shared hit=31624
        ->  Nested Loop Left Join  (cost=1539.81..7175.47 rows=1 width=151) (actual time=1.080..48.575 rows=13500 loops=1)
              Buffers: shared hit=31624
              ->  Gather  (cost=1539.52..7167.09 rows=1 width=115) (actual time=1.067..2.769 rows=13500 loops=1)
                    Workers Planned: 2
                    Workers Launched: 2
                    Buffers: shared hit=1291
                    ->  Parallel Bitmap Heap Scan on clients c  (cost=539.52..6166.99 rows=1 width=115) (actual time=0.317..19.034 rows=4500 loops=3)
                          Recheck Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                          Filter: (("deletedAt" IS NULL) AND active AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text)) AND (lat >= 36.30413981813773) AND (lat <= 37.20346018186227) AND (lng >= 2.4942468726687776) AND (lng <= 3.6233531273312227) AND (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((lat)::double precision))) * power(sin((radians(((lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision))))))) <= '50000'::double precision))
                          Rows Removed by Filter: 12167
                          Heap Blocks: exact=22
                          Buffers: shared hit=1291
                          ->  Bitmap Index Scan on "clients_tenantId_sectorId_idx"  (cost=0.00..539.52 rows=50030 width=0) (actual time=0.776..0.776 rows=50000 loops=1)
                                Index Cond: ("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid)
                                Buffers: shared hit=41
              ->  Index Scan using "client_balances_clientId_key" on client_balances b  (cost=0.29..8.32 rows=1 width=21) (actual time=0.001..0.001 rows=0 loops=13500)
                    Index Cond: ("clientId" = c.id)
                    Filter: (("tenantId" = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (current_setting('app.rls_bypass'::text, true) = 'on'::text))
                    Buffers: shared hit=30333
Planning:
  Buffers: shared hit=14
Planning Time: 0.236 ms
Execution Time: 51.442 ms
```

As erp, the table owner (no row-level security):

```
Limit  (cost=5802.52..5802.77 rows=100 width=151) (actual time=78.077..78.087 rows=100 loops=1)
  Buffers: shared hit=1731
  ->  Sort  (cost=5802.52..5805.48 rows=1183 width=151) (actual time=78.076..78.081 rows=100 loops=1)
        Sort Key: (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((c.lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((c.lat)::double precision))) * power(sin((radians(((c.lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision)))))))), c.name, c.id
        Sort Method: top-N heapsort  Memory: 50kB
        Buffers: shared hit=1731
        ->  Hash Right Join  (cost=4993.16..5757.31 rows=1183 width=151) (actual time=39.039..75.521 rows=13500 loops=1)
              Hash Cond: (b."clientId" = c.id)
              Buffers: shared hit=1731
              ->  Seq Scan on client_balances b  (cost=0.00..620.00 rows=29000 width=21) (actual time=0.006..1.220 rows=29000 loops=1)
                    Buffers: shared hit=330
              ->  Hash  (cost=4978.37..4978.37 rows=1183 width=115) (actual time=39.023..39.023 rows=13500 loops=1)
                    Buckets: 16384 (originally 2048)  Batches: 1 (originally 1)  Memory Usage: 1840kB
                    Buffers: shared hit=1401
                    ->  Bitmap Heap Scan on clients c  (cost=874.23..4978.37 rows=1183 width=115) (actual time=2.141..36.805 rows=13500 loops=1)
                          Recheck Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.30413981813773) AND (lat <= 37.20346018186227) AND (lng IS NOT NULL) AND (lng >= 2.4942468726687776) AND (lng <= 3.6233531273312227) AND ("deletedAt" IS NULL))
                          Filter: (active AND (('12742017.6'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((lat)::double precision - '36.7538'::double precision)) / '2'::double precision)), '2'::double precision) + (('0.8012141285386146'::double precision * cos(radians((lat)::double precision))) * power(sin((radians(((lng)::double precision - '3.0588'::double precision)) / '2'::double precision)), '2'::double precision))))))) <= '50000'::double precision))
                          Rows Removed by Filter: 834
                          Heap Blocks: exact=1250
                          Buffers: shared hit=1401
                          ->  Bitmap Index Scan on clients_tenant_geo_idx  (cost=0.00..873.94 rows=4152 width=0) (actual time=2.045..2.046 rows=14334 loops=1)
                                Index Cond: (("tenantId" = '1fd13c47-0ec6-4501-bf59-a3fb5d71e724'::uuid) AND (lat >= 36.30413981813773) AND (lat <= 37.20346018186227) AND (lng IS NOT NULL) AND (lng >= 2.4942468726687776) AND (lng <= 3.6233531273312227))
                                Buffers: shared hit=151
Planning:
  Buffers: shared hit=14
Planning Time: 0.253 ms
Execution Time: 78.251 ms
```
