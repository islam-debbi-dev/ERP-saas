-- Test 35, part C: bulk clients for one tenant of the performance database (erp_t35_perf).
-- Run by e2e/api/map-perf.ts, statement by statement (split on the "-- @@" lines).
--   $1 tenant id   $2 number of clients   $3 owner id   $4 a seller id (or null)   $5 code prefix
-- Points are spread around Alger, Oran and Sétif like the functional seed: 10 % without a
-- point, 4 % archived, 5 % inactive, one in eight assigned to the seller, 20 % with a debt.
-- hashtext() makes the draw the same on every run.

-- @@ clients
INSERT INTO clients (id, "tenantId", code, name, phone, wilaya, commune, lat, lng, "geoAccuracyM",
  "geoSetAt", "geoSetBy", active, "deletedAt", "assignedSellerId", "creditLimit", "updatedAt")
SELECT gen_random_uuid(), $1::uuid,
  $5 || '-' || lpad(i::text, 6, '0'),
  (ARRAY['Alimentation','Superette','Épicerie','Grossiste','Kiosque','Café','Bazar','Hanout'])[1 + (hashtext('n' || i) & 7)] || ' ' || lpad(i::text, 6, '0'),
  '05' || lpad(((hashtext('p' || i) & 2147483647) % 100000000)::text, 8, '0'),
  (ARRAY['Alger','Oran','Sétif'])[1 + i % 3],
  (ARRAY['Alger Centre','Oran','Sétif'])[1 + i % 3],
  CASE WHEN i % 10 = 9 THEN NULL ELSE round(((ARRAY[36.7538, 35.6971, 36.1898])[1 + i % 3] + ((hashtext('a' || i) & 65535) / 65535.0 - 0.5) * 0.30)::numeric, 6) END,
  CASE WHEN i % 10 = 9 THEN NULL ELSE round(((ARRAY[3.0588, -0.6308, 5.4108])[1 + i % 3] + ((hashtext('o' || i) & 65535) / 65535.0 - 0.5) * 0.36)::numeric, 6) END,
  CASE WHEN i % 10 = 9 THEN NULL ELSE 12 END,
  CASE WHEN i % 10 = 9 THEN NULL ELSE now() END,
  CASE WHEN i % 10 = 9 THEN NULL ELSE $3::uuid END,
  i % 20 <> 3,
  CASE WHEN i % 25 = 7 THEN now() ELSE NULL END,
  CASE WHEN i % 8 = 0 THEN $4::uuid ELSE NULL END,
  CASE WHEN i % 7 = 2 THEN 5000 ELSE NULL END,
  now()
FROM generate_series(0, $2::int - 1) AS i;

-- @@ ledger
INSERT INTO client_ledger_entries (id, "tenantId", "clientId", type, amount, label, "createdBy")
SELECT gen_random_uuid(), c."tenantId", c.id, 'OPENING', ((right(c.code, 6)::int % 9) + 1) * 1500, 'Solde initial (test 35)', $3::uuid
FROM clients c
WHERE c."tenantId" = $1::uuid AND c.code LIKE $5 || '-%' AND right(c.code, 6)::int % 5 = 1;

-- @@ balances
INSERT INTO client_balances (id, "tenantId", "clientId", balance, "hasOpening", "updatedAt")
SELECT gen_random_uuid(), l."tenantId", l."clientId", l.amount, true, now()
FROM client_ledger_entries l
WHERE l."tenantId" = $1::uuid AND l.label = 'Solde initial (test 35)';
