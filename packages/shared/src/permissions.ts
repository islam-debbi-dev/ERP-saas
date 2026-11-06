import { Role } from './enums';

/**
 * What a user may do on top of (or despite) his role. The API checks them (route guard
 * for module actions, services for sensitive ones); the web only hides what the user
 * cannot do.
 */
export const Permission = {
  /** Sell at a price other than the client's price level. */
  PRICE_OVERRIDE: 'PRICE_OVERRIDE',
  /** Give a line discount above the tenant's `maxDiscountPct`. */
  DISCOUNT_ABOVE_X: 'DISCOUNT_ABOVE_X',
  /** Validate a sale over the client's plafond (BLOCK mode). */
  CREDIT_OVERRIDE: 'CREDIT_OVERRIDE',
  /** Cancel a validated sale. */
  SALE_CANCEL: 'SALE_CANCEL',
  /** Cancel any versement (without it: only your own, the same day). */
  PAYMENT_CANCEL: 'PAYMENT_CANCEL',
  /** Stock adjustments, opening stock, inventory validation and cancel. */
  STOCK_ADJUST: 'STOCK_ADJUST',
  /** See CUMP, stock value, costs and margins. */
  VIEW_COST_AND_MARGIN: 'VIEW_COST_AND_MARGIN',
  /** Export reports to Excel. */
  EXPORT_DATA: 'EXPORT_DATA',
  /** Change the seller of a validated sale or the collector of a versement (phase 14). */
  SALE_REASSIGN_SELLER: 'SALE_REASSIGN_SELLER',
  /** Save a far or mocked operation when the tenant blocks them (phase 17). */
  GEO_OVERRIDE: 'GEO_OVERRIDE',
  /** Approve the month's bonuses (phase 18). The owner always can; not a manager default. */
  INCENTIVE_APPROVE: 'INCENTIVE_APPROVE',
  /** Change the free units (UG) or the remise a promotion gave a line (phase 20). */
  PROMO_OVERRIDE: 'PROMO_OVERRIDE',

  // Module permissions (phase 24). Their role defaults reproduce the role lists the
  // routes had before, so nobody gained or lost a right when they appeared.
  PRODUCTS_VIEW: 'PRODUCTS_VIEW',
  PRODUCTS_CREATE: 'PRODUCTS_CREATE',
  /** Edit, archive and restore products, brands, categories and price levels. */
  PRODUCTS_EDIT: 'PRODUCTS_EDIT',
  STOCK_VIEW: 'STOCK_VIEW',
  /** Start and fill an inventory (validating it needs STOCK_ADJUST). */
  STOCK_COUNT: 'STOCK_COUNT',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
  PURCHASES_VIEW: 'PURCHASES_VIEW',
  /** Create and edit a BR draft. */
  PURCHASES_CREATE: 'PURCHASES_CREATE',
  PURCHASES_VALIDATE: 'PURCHASES_VALIDATE',
  /** Cancel a BR and make a retour fournisseur. */
  PURCHASES_CANCEL: 'PURCHASES_CANCEL',
  SUPPLIERS_VIEW: 'SUPPLIERS_VIEW',
  SUPPLIERS_CREATE: 'SUPPLIERS_CREATE',
  SUPPLIERS_EDIT: 'SUPPLIERS_EDIT',
  /** Supplier balances, ledgers, statements and règlements list. */
  SUPPLIERS_ACCOUNT: 'SUPPLIERS_ACCOUNT',
  /** Record or cancel a règlement fournisseur. */
  SUPPLIERS_PAY: 'SUPPLIERS_PAY',
  CLIENTS_VIEW: 'CLIENTS_VIEW',
  CLIENTS_CREATE: 'CLIENTS_CREATE',
  CLIENTS_EDIT: 'CLIENTS_EDIT',
  CLIENTS_ARCHIVE: 'CLIENTS_ARCHIVE',
  /** Opening balance and manual adjustments of a client account. */
  CLIENTS_BALANCE_ADJUST: 'CLIENTS_BALANCE_ADJUST',
  SALES_VIEW: 'SALES_VIEW',
  /** Create, edit, validate a sale (cancelling a validated one also needs SALE_CANCEL). */
  SALES_CREATE: 'SALES_CREATE',
  /** Retour client (avoir). */
  SALES_RETURN: 'SALES_RETURN',
  PAYMENTS_VIEW: 'PAYMENTS_VIEW',
  PAYMENTS_CREATE: 'PAYMENTS_CREATE',
  /** Mark a cheque as unpaid (impayé). */
  PAYMENTS_BOUNCE: 'PAYMENTS_BOUNCE',
  REPORTS_VIEW: 'REPORTS_VIEW',
  /** Aging of clients and suppliers. */
  REPORTS_FINANCE: 'REPORTS_FINANCE',
  USERS_VIEW: 'USERS_VIEW',
  /** Invite, edit, deactivate users and change their permissions (never above his own). */
  USERS_MANAGE: 'USERS_MANAGE',
  /** Company settings and dépôts. */
  SETTINGS_EDIT: 'SETTINGS_EDIT',
  /** Ask the in-app assistant (phase 30). Its data tools need their own permissions too. */
  USE_ASSISTANT: 'USE_ASSISTANT',
  /** Sell a product outside the brands and categories of the dépôt. */
  SELL_ANY_PRODUCT: 'SELL_ANY_PRODUCT',
  /** Give or take a user's access to dépôts (never above his own). */
  WAREHOUSE_ACCESS_MANAGE: 'WAREHOUSE_ACCESS_MANAGE',
  /** Work in and see every dépôt, as the owner does. */
  VIEW_ALL_WAREHOUSES: 'VIEW_ALL_WAREHOUSES',

  // Trésorerie (phase 34, module TREASURY).
  /** See the balances and the movements of the accounts in reach. */
  TREASURY_VIEW: 'TREASURY_VIEW',
  /** Transfers between accounts and comptages de caisse. */
  TREASURY_OPERATE: 'TREASURY_OPERATE',
  /** Create and archive accounts, enter a solde initial. */
  TREASURY_MANAGE: 'TREASURY_MANAGE',
  // Dépenses and rent (phase 25, module EXPENSES).
  EXPENSES_VIEW: 'EXPENSES_VIEW',
  EXPENSES_CREATE: 'EXPENSES_CREATE',
  /** Cancel a dépense (with a reason). */
  EXPENSE_CANCEL: 'EXPENSE_CANCEL',
  /** Expense categories and rent contracts (baux). */
  RENT_MANAGE: 'RENT_MANAGE',

  // DRH (phase 31, module HR).
  /** See the employees, their pointage and their congés (never their pay). */
  HR_VIEW: 'HR_VIEW',
  /** Employees and the calendar. */
  HR_MANAGE: 'HR_MANAGE',
  ATTENDANCE_MARK: 'ATTENDANCE_MARK',
  /** Replace the status of a day already marked (with a reason). */
  ATTENDANCE_CORRECT: 'ATTENDANCE_CORRECT',
  LEAVE_APPROVE: 'LEAVE_APPROVE',
  /** Pay an avance sur salaire (also needs SALARY_VIEW). */
  ADVANCE_PAY: 'ADVANCE_PAY',
  /** See salaries, avances and the employee ledger. Without it they do not exist. */
  SALARY_VIEW: 'SALARY_VIEW',

  // Paie (phase 31b, module PAYROLL). Each also needs SALARY_VIEW.
  /** Payroll settings, primes, draft runs and their lines. */
  PAYROLL_MANAGE: 'PAYROLL_MANAGE',
  /** Approve a run (frozen) or cancel one. */
  PAYROLL_APPROVE: 'PAYROLL_APPROVE',
  /** Pay the salaries of an approved run. */
  PAYROLL_PAY: 'PAYROLL_PAY',
  /** Set the company's own rates, or accept the indicative platform ones. */
  PAYROLL_RATES_MANAGE: 'PAYROLL_RATES_MANAGE',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const PERMISSIONS = Object.values(Permission);

/** Modules of the permission grid, in screen order. */
export const PERMISSION_GROUPS = {
  products: [Permission.PRODUCTS_VIEW, Permission.PRODUCTS_CREATE, Permission.PRODUCTS_EDIT],
  stock: [
    Permission.STOCK_VIEW,
    Permission.STOCK_COUNT,
    Permission.STOCK_TRANSFER,
    Permission.STOCK_ADJUST,
  ],
  purchases: [
    Permission.PURCHASES_VIEW,
    Permission.PURCHASES_CREATE,
    Permission.PURCHASES_VALIDATE,
    Permission.PURCHASES_CANCEL,
  ],
  suppliers: [
    Permission.SUPPLIERS_VIEW,
    Permission.SUPPLIERS_CREATE,
    Permission.SUPPLIERS_EDIT,
    Permission.SUPPLIERS_ACCOUNT,
    Permission.SUPPLIERS_PAY,
  ],
  clients: [
    Permission.CLIENTS_VIEW,
    Permission.CLIENTS_CREATE,
    Permission.CLIENTS_EDIT,
    Permission.CLIENTS_ARCHIVE,
    Permission.CLIENTS_BALANCE_ADJUST,
    Permission.CREDIT_OVERRIDE,
  ],
  sales: [
    Permission.SALES_VIEW,
    Permission.SALES_CREATE,
    Permission.SALE_CANCEL,
    Permission.SALES_RETURN,
    Permission.PRICE_OVERRIDE,
    Permission.DISCOUNT_ABOVE_X,
    Permission.PROMO_OVERRIDE,
    Permission.SALE_REASSIGN_SELLER,
    Permission.SELL_ANY_PRODUCT,
    Permission.GEO_OVERRIDE,
  ],
  payments: [
    Permission.PAYMENTS_VIEW,
    Permission.PAYMENTS_CREATE,
    Permission.PAYMENT_CANCEL,
    Permission.PAYMENTS_BOUNCE,
  ],
  reports: [
    Permission.REPORTS_VIEW,
    Permission.REPORTS_FINANCE,
    Permission.VIEW_COST_AND_MARGIN,
    Permission.EXPORT_DATA,
    Permission.INCENTIVE_APPROVE,
  ],
  users: [
    Permission.USERS_VIEW,
    Permission.USERS_MANAGE,
    Permission.WAREHOUSE_ACCESS_MANAGE,
    Permission.VIEW_ALL_WAREHOUSES,
  ],
  expenses: [
    Permission.EXPENSES_VIEW,
    Permission.EXPENSES_CREATE,
    Permission.EXPENSE_CANCEL,
    Permission.RENT_MANAGE,
  ],
  treasury: [
    Permission.TREASURY_VIEW,
    Permission.TREASURY_OPERATE,
    Permission.TREASURY_MANAGE,
  ],
  hr: [
    Permission.HR_VIEW,
    Permission.HR_MANAGE,
    Permission.ATTENDANCE_MARK,
    Permission.ATTENDANCE_CORRECT,
    Permission.LEAVE_APPROVE,
    Permission.ADVANCE_PAY,
    Permission.SALARY_VIEW,
    Permission.PAYROLL_MANAGE,
    Permission.PAYROLL_APPROVE,
    Permission.PAYROLL_PAY,
    Permission.PAYROLL_RATES_MANAGE,
  ],
  settings: [Permission.SETTINGS_EDIT, Permission.USE_ASSISTANT],
} as const satisfies Record<string, readonly Permission[]>;
export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

/** The phase 1–23 permissions: the only ones the grid shows without MULTI_UNIT. */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  Permission.PRICE_OVERRIDE,
  Permission.DISCOUNT_ABOVE_X,
  Permission.CREDIT_OVERRIDE,
  Permission.SALE_CANCEL,
  Permission.PAYMENT_CANCEL,
  Permission.STOCK_ADJUST,
  Permission.VIEW_COST_AND_MARGIN,
  Permission.EXPORT_DATA,
  Permission.SALE_REASSIGN_SELLER,
  Permission.GEO_OVERRIDE,
  Permission.INCENTIVE_APPROVE,
  Permission.PROMO_OVERRIDE,
];

/** Every role reads the catalog, stock, documents and its own reports (as before). */
const VIEW_ALL: readonly Permission[] = [
  Permission.PRODUCTS_VIEW,
  Permission.STOCK_VIEW,
  Permission.PURCHASES_VIEW,
  Permission.SUPPLIERS_VIEW,
  Permission.CLIENTS_VIEW,
  Permission.SALES_VIEW,
  Permission.PAYMENTS_VIEW,
  Permission.REPORTS_VIEW,
  // Help is for everyone; the assistant's data tools still need their own permissions.
  Permission.USE_ASSISTANT,
];
/** What the road roles (seller, supervisor) did besides reading. */
const FIELD: readonly Permission[] = [
  Permission.CLIENTS_CREATE,
  Permission.CLIENTS_EDIT,
  Permission.SALES_CREATE,
  Permission.PAYMENTS_CREATE,
];
/** What the storekeeper did besides reading. */
const STORE: readonly Permission[] = [
  Permission.PURCHASES_CREATE,
  Permission.STOCK_COUNT,
  Permission.STOCK_TRANSFER,
];
/** The owner's alone unless he grants them. */
const OWNER_ONLY: readonly Permission[] = [
  Permission.INCENTIVE_APPROVE,
  Permission.USERS_MANAGE,
  Permission.SELL_ANY_PRODUCT,
  Permission.WAREHOUSE_ACCESS_MANAGE,
  Permission.VIEW_ALL_WAREHOUSES,
  // The solde initial is the owner's figure (phase 34).
  Permission.TREASURY_MANAGE,
  // A dépôt manager marks attendance but does not see pay (phase 31).
  Permission.SALARY_VIEW,
  Permission.ADVANCE_PAY,
  Permission.PAYROLL_MANAGE,
  Permission.PAYROLL_APPROVE,
  Permission.PAYROLL_PAY,
  Permission.PAYROLL_RATES_MANAGE,
];

/** What each role can do by default. The OWNER always has everything. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.OWNER]: PERMISSIONS,
  [Role.MANAGER]: PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)),
  [Role.SELLER]: [...VIEW_ALL, ...FIELD],
  // Counts stock but does not adjust it or validate an inventory (AGENTS: MANAGER+).
  [Role.STOREKEEPER]: [...VIEW_ALL, ...STORE],
  // Sees his team's figures; sensitive actions are granted one by one by the owner.
  [Role.SUPERVISOR]: [...VIEW_ALL, ...FIELD],
  [Role.LIVREUR]: [...VIEW_ALL],
};

/**
 * Role defaults, plus what was granted to this user, minus what was taken away.
 * The OWNER's permissions cannot be reduced (there must always be someone who can do everything).
 */
export function effectivePermissions(
  role: Role,
  grants: readonly string[] = [],
  revokes: readonly string[] = [],
): Permission[] {
  if (role === Role.OWNER) return [...PERMISSIONS];
  const set = new Set<string>(ROLE_PERMISSIONS[role]);
  for (const g of grants) set.add(g);
  for (const r of revokes) set.delete(r);
  return PERMISSIONS.filter((p) => set.has(p));
}

export function hasPermission(user: { permissions: readonly string[] }, p: Permission): boolean {
  return user.permissions.includes(p);
}
