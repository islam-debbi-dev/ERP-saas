/**
 * The plans on sale (phase 13), DZD per month. The migration inserts them and the seed
 * upserts them, so a fresh database and production agree. Null limit = unlimited.
 */
export const PLAN_DEFAULTS = [
  {
    code: 'STARTER',
    name: 'Starter',
    monthlyPrice: '2500.00',
    maxUsers: 2,
    maxProducts: 500,
    maxDocumentsPerMonth: 300,
    maxMobileSellers: 2,
    sortOrder: 1,
  },
  {
    code: 'PRO',
    name: 'Pro',
    monthlyPrice: '4500.00',
    maxUsers: 5,
    maxProducts: 3000,
    maxDocumentsPerMonth: 1500,
    maxMobileSellers: 5,
    sortOrder: 2,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    monthlyPrice: '8000.00',
    maxUsers: null,
    maxProducts: null,
    maxDocumentsPerMonth: null,
    maxMobileSellers: null,
    sortOrder: 3,
  },
] as const;

/** New tenants try the software on this plan. */
export const TRIAL_PLAN_CODE = 'PRO';

/**
 * What each edition adds to the plan's price (phase 13b), DZD per month. Like the plans,
 * the migration inserts them and the seed upserts them; change a price in the table.
 */
export const EDITION_PRICE_DEFAULTS = [
  { edition: 'ESSENTIEL', monthlySupplement: '0.00', sortOrder: 1 },
  { edition: 'IMPORT', monthlySupplement: '1500.00', sortOrder: 2 },
  { edition: 'DISTRIBUTION', monthlySupplement: '2500.00', sortOrder: 3 },
  { edition: 'ENTREPRISE', monthlySupplement: '4000.00', sortOrder: 4 },
] as const;
