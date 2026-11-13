-- REPORT-35, A-1: the owner decides which clients a livreur sees. ALL_CLIENTS is what
-- every company has had since phase 14, so nothing changes until the owner chooses.
-- Additive: one enum, one column with a default.
CREATE TYPE "LivreurScope" AS ENUM ('ALL_CLIENTS', 'OWN_DELIVERIES');

ALTER TABLE "tenants" ADD COLUMN "livreurScope" "LivreurScope" NOT NULL DEFAULT 'ALL_CLIENTS';
