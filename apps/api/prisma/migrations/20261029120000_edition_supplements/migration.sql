-- The real edition supplements, DZD per month on top of the plan price. Only the rows still
-- at the 0 placeholder of phase 13b change: a price already set in the table is kept.
UPDATE "edition_prices" SET "monthlySupplement" = 1500.00, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "edition" = 'IMPORT' AND "monthlySupplement" = 0;
UPDATE "edition_prices" SET "monthlySupplement" = 2500.00, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "edition" = 'DISTRIBUTION' AND "monthlySupplement" = 0;
UPDATE "edition_prices" SET "monthlySupplement" = 4000.00, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "edition" = 'ENTREPRISE' AND "monthlySupplement" = 0;
