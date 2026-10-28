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
    sortOrder: 1,
  },
  {
    code: 'PRO',
    name: 'Pro',
    monthlyPrice: '4500.00',
    maxUsers: 5,
    maxProducts: 3000,
    maxDocumentsPerMonth: 1500,
    sortOrder: 2,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    monthlyPrice: '8000.00',
    maxUsers: null,
    maxProducts: null,
    maxDocumentsPerMonth: null,
    sortOrder: 3,
  },
] as const;

/** New tenants try the software on this plan. */
export const TRIAL_PLAN_CODE = 'PRO';
