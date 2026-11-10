-- Phase 33: the owner's monthly sales target (additive, nullable).
ALTER TABLE "tenants" ADD COLUMN "monthlySalesTarget" DECIMAL(14,2);
