import { Role } from './enums';

/**
 * Sensitive actions a user may do on top of (or despite) his role. The API checks
 * them in the services; the web only hides what the user cannot do.
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
  /** Stock adjustments and inventory validation. */
  STOCK_ADJUST: 'STOCK_ADJUST',
  /** See CUMP, stock value, costs and margins. */
  VIEW_COST_AND_MARGIN: 'VIEW_COST_AND_MARGIN',
  /** Export reports to Excel. */
  EXPORT_DATA: 'EXPORT_DATA',
  /** Change the seller of a validated sale or the collector of a versement (phase 14). */
  SALE_REASSIGN_SELLER: 'SALE_REASSIGN_SELLER',
  /** Save a far or mocked operation when the tenant blocks them (phase 17). */
  GEO_OVERRIDE: 'GEO_OVERRIDE',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const PERMISSIONS = Object.values(Permission);

/** What each role can do by default. The OWNER always has everything. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.OWNER]: PERMISSIONS,
  [Role.MANAGER]: PERMISSIONS,
  [Role.SELLER]: [],
  // Counts stock but does not adjust it or validate an inventory (AGENTS: MANAGER+).
  [Role.STOREKEEPER]: [],
  // Sees his team's figures; sensitive actions are granted one by one by the owner.
  [Role.SUPERVISOR]: [],
  [Role.LIVREUR]: [],
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
