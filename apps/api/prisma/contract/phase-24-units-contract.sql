-- Phase 24, step 3 of 3 (contract). NOT part of the phase 24 release.
--
-- Apply in a LATER release, only after `db:backfill-units` ran cleanly in production
-- (docs/runbook.md, "Units backfill"). To ship it: create a migration folder
-- (e.g. migrations/<timestamp>_units_contract/), move this file there as migration.sql,
-- and in schema.prisma make `warehouseId` required (`String`, relation `Warehouse`) on
-- Payment and ClientLedgerEntry.

-- Refuse loudly if the backfill missed anything.
DO $$
DECLARE missing bigint;
BEGIN
  SELECT (SELECT count(*) FROM "payments" WHERE "warehouseId" IS NULL)
       + (SELECT count(*) FROM "client_ledger_entries" WHERE "warehouseId" IS NULL)
       + (SELECT count(*) FROM "warehouses"
          WHERE "type" = 'VEHICLE' AND "parentWarehouseId" IS NULL AND "deletedAt" IS NULL)
    INTO missing;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Run db:backfill-units first: % rows have no dépôt', missing;
  END IF;
END $$;

-- destructive-ok: phase 24 contract step, every versement has a dépôt since the backfill
ALTER TABLE "payments" ALTER COLUMN "warehouseId" SET NOT NULL;
-- destructive-ok: phase 24 contract step, every ledger entry has a dépôt since the backfill
ALTER TABLE "client_ledger_entries" ALTER COLUMN "warehouseId" SET NOT NULL;

-- A live truck always belongs to a dépôt.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_vehicle_has_parent_check"
  CHECK ("type" <> 'VEHICLE' OR "deletedAt" IS NOT NULL OR "parentWarehouseId" IS NOT NULL);

-- The client ledger is strictly append-only again (the backfill exception is no longer needed).
CREATE OR REPLACE FUNCTION "client_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'client_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
