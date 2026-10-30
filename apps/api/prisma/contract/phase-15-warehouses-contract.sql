-- Phase 15, step 3 of 3 (contract). NOT part of the phase 15 release.
--
-- Apply in a LATER release, only after `db:backfill-warehouses` ran cleanly in production
-- (docs/runbook.md, "Warehouse backfill"). To ship it: create a migration folder
-- (e.g. migrations/<timestamp>_warehouses_contract/), move this file there as
-- migration.sql, and in schema.prisma make `warehouseId` required (`String`, relation
-- `Warehouse`) on StockMovement, SaleReturn, PurchaseReturn and Inventory. Sale and
-- Purchase keep `String?`: a draft has no dépôt until it is validated.

-- Refuse loudly if the backfill missed anything (the statements below would fail anyway,
-- with a less helpful message).
DO $$
DECLARE missing bigint;
BEGIN
  SELECT (SELECT count(*) FROM "stock_movements" WHERE "warehouseId" IS NULL)
       + (SELECT count(*) FROM "sale_returns" WHERE "warehouseId" IS NULL)
       + (SELECT count(*) FROM "purchase_returns" WHERE "warehouseId" IS NULL)
       + (SELECT count(*) FROM "inventories" WHERE "warehouseId" IS NULL)
       + (SELECT count(*) FROM "sales" WHERE "warehouseId" IS NULL AND status <> 'DRAFT')
       + (SELECT count(*) FROM "purchases" WHERE "warehouseId" IS NULL AND status <> 'DRAFT')
    INTO missing;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Run db:backfill-warehouses first: % rows have no warehouse', missing;
  END IF;
END $$;

-- destructive-ok: phase 15 contract step, every row has a dépôt since the backfill
ALTER TABLE "stock_movements" ALTER COLUMN "warehouseId" SET NOT NULL;
-- destructive-ok: phase 15 contract step, every row has a dépôt since the backfill
ALTER TABLE "sale_returns" ALTER COLUMN "warehouseId" SET NOT NULL;
-- destructive-ok: phase 15 contract step, every row has a dépôt since the backfill
ALTER TABLE "purchase_returns" ALTER COLUMN "warehouseId" SET NOT NULL;
-- destructive-ok: phase 15 contract step, every row has a dépôt since the backfill
ALTER TABLE "inventories" ALTER COLUMN "warehouseId" SET NOT NULL;

-- Drafts may still have no dépôt (chosen at validation); anything else must.
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_when_not_draft_check"
  CHECK (status = 'DRAFT' OR "warehouseId" IS NOT NULL);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouse_when_not_draft_check"
  CHECK (status = 'DRAFT' OR "warehouseId" IS NOT NULL);

-- The ledger is strictly append-only again (the backfill exception is no longer needed).
CREATE OR REPLACE FUNCTION "stock_movements_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
