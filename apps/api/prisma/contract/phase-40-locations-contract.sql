-- Phase 40a, step 3 of 3 (contract). NOT part of the phase 40a release.
--
-- Apply in a LATER release, only after `db:backfill-communes` ran in production, every
-- client and sector of its CSV was fixed on screen, and no version of the web or of the
-- app that reads or writes the text columns is still in use (docs/runbook.md, "Commune
-- backfill"). To ship it: create a migration folder
-- (e.g. migrations/<timestamp>_locations_contract/), move this file there as
-- migration.sql, remove `wilaya` / `commune` from Client and `wilaya` / `communes` from
-- Sector in schema.prisma, and remove the text fields from the schemas, the services, the
-- import and the backfill.

-- Refuse loudly while a text has no code: dropping the column would destroy it.
DO $$
DECLARE missing bigint;
BEGIN
  SELECT (SELECT count(*) FROM "clients"
          WHERE (btrim(coalesce("wilaya", '')) <> '' AND "wilayaCode" IS NULL)
             OR (btrim(coalesce("commune", '')) <> '' AND "communeCode" IS NULL))
       + (SELECT count(*) FROM "sectors"
          WHERE "deletedAt" IS NULL
            AND ((btrim(coalesce("wilaya", '')) <> '' AND "wilayaCode" IS NULL)
              OR cardinality("communes") > coalesce(cardinality("communeCodes"), 0)))
    INTO missing;
  IF missing > 0 THEN
    RAISE EXCEPTION '% clients or sectors still have a location text without a code', missing;
  END IF;
END $$;

-- destructive-ok: phase 40a contract step, every text has its code
ALTER TABLE "clients" DROP COLUMN "wilaya";
-- destructive-ok: phase 40a contract step, every text has its code
ALTER TABLE "clients" DROP COLUMN "commune";
-- destructive-ok: phase 40a contract step, every text has its code
ALTER TABLE "sectors" DROP COLUMN "wilaya";
-- destructive-ok: phase 40a contract step, every text has its code
ALTER TABLE "sectors" DROP COLUMN "communes";
