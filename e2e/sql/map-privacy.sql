-- Test 35, part B: is a position sent to /clients/nearby stored anywhere?
--
-- $1 = text[] of needles (the coordinates that were sent, as written in the request).
-- Reads every column of every table of the public schema whose type can hold a coordinate
-- (text, varchar, numeric, float, json, jsonb, arrays of them) and returns one row per
-- (table, column, needle) that contains it. No row = nothing stored.
--
-- Run by e2e/api/map-privacy.ts; by hand:
--   psql "$DB" -v needles="{36.761357,3.047913}" -f e2e/sql/map-privacy.sql   (replace $1 by :'needles')
--
-- The seeded clients have their own coordinates in clients.lat / clients.lng: the needles
-- are chosen so that no seeded point equals them.
WITH cols AS (
  SELECT c.table_name AS tbl, c.column_name AS col
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.table_name <> '_prisma_migrations'
    AND (c.data_type IN ('text', 'character varying', 'character', 'numeric', 'double precision', 'real', 'json', 'jsonb', 'ARRAY'))
),
needles AS (
  SELECT unnest($1::text[]) AS needle
),
scan AS (
  SELECT cols.tbl, cols.col, needles.needle,
    (xpath('/row/n/text()', query_to_xml(
      format('SELECT count(*) AS n FROM %I WHERE %I::text LIKE %L', cols.tbl, cols.col, '%' || needles.needle || '%'),
      false, true, '')))[1]::text::int AS hits
  FROM cols CROSS JOIN needles
)
SELECT tbl, col, needle, hits FROM scan WHERE hits > 0 ORDER BY tbl, col, needle;
