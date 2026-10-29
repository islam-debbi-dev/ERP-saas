-- CreateEnum
CREATE TYPE "Edition" AS ENUM ('ESSENTIEL', 'IMPORT', 'DISTRIBUTION', 'ENTREPRISE');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "maxMobileSellers" INTEGER;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "edition" "Edition" NOT NULL DEFAULT 'ESSENTIEL';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "featureGrants" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "featureRevokes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "edition_prices" (
    "edition" "Edition" NOT NULL,
    "monthlySupplement" DECIMAL(14,2) NOT NULL,
    "sortOrder" SMALLINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "edition_prices_pkey" PRIMARY KEY ("edition")
);

-- Editions (phase 13b). The supplement is added to the plan's monthly price; 0 until the
-- real prices are set in this table. The seed upserts the same rows.
INSERT INTO "edition_prices" ("edition", "monthlySupplement", "sortOrder", "updatedAt") VALUES
  ('ESSENTIEL',    0.00, 1, CURRENT_TIMESTAMP),
  ('IMPORT',       0.00, 2, CURRENT_TIMESTAMP),
  ('DISTRIBUTION', 0.00, 3, CURRENT_TIMESTAMP),
  ('ENTREPRISE',   0.00, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("edition") DO NOTHING;

-- A mobile seller is a user: the user limit already caps them.
UPDATE "plans" SET "maxMobileSellers" = "maxUsers" WHERE "code" IN ('STARTER', 'PRO', 'BUSINESS');

-- Pilots keep every module; trials from phase 13 were all on the core.
UPDATE "subscriptions" SET "edition" = 'ENTREPRISE' WHERE "isFree" = true;
