import {
  BadgePercent,
  Banknote,
  ClipboardList,
  Fingerprint,
  LayoutGrid,
  MapPinCheck,
  MapPinned,
  Navigation,
  PackageCheck,
  ChartColumn,
  LayoutDashboard,
  type LucideIcon,
  Package,
  ReceiptText,
  Settings,
  Trophy,
  Truck,
  UserCheck,
  Users,
  Warehouse,
  Ship,
  Wallet,
} from 'lucide-react';
import { Feature, Permission, Role } from '@erp/shared';

export type NavKey =
  | 'overview'
  | 'dashboard'
  | 'sales'
  | 'versements'
  | 'clients'
  | 'today'
  | 'tournees'
  | 'orders'
  | 'deliveries'
  | 'promotions'
  | 'products'
  | 'purchases'
  | 'importFiles'
  | 'stock'
  | 'flagged'
  | 'incentives'
  | 'expenses'
  | 'hr'
  | 'myAttendance'
  | 'reports'
  | 'settings';

export interface NavItem {
  key: NavKey;
  url: string;
  icon: LucideIcon;
  /** A module outside the core (phase 13b): hidden when the company does not have it. */
  feature?: Feature;
  /** Only these roles see it (the API checks anyway); everyone when absent. */
  roles?: readonly Role[];
  /** Only users with this permission see it (phase 25), whatever their role. */
  permission?: Permission;
}

const PLANNERS = [Role.OWNER, Role.MANAGER, Role.SUPERVISOR];

export interface NavGroup {
  key: 'groupMain' | 'groupStock' | 'groupManagement';
  items: NavItem[];
}

/** Icons live here; every label is resolved from `nav.<key>` at render time. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'groupMain',
    items: [
      // Phase 26: first for whoever sees more than one dépôt (the sidebar checks the count).
      {
        key: 'overview',
        url: '/vue-ensemble',
        icon: LayoutGrid,
        feature: Feature.MULTI_UNIT,
        permission: Permission.REPORTS_FINANCE,
      },
      { key: 'dashboard', url: '/tableau-de-bord', icon: LayoutDashboard },
      { key: 'sales', url: '/ventes', icon: ReceiptText },
      { key: 'versements', url: '/versements', icon: Banknote },
      { key: 'clients', url: '/clients', icon: Users },
      // Phase 16: before 'tournees' so /tournees/aujourdhui is "today" for a seller.
      {
        key: 'today',
        url: '/tournees/aujourdhui',
        icon: Navigation,
        feature: Feature.TOURNEES,
        roles: [Role.SELLER],
      },
      {
        key: 'tournees',
        url: '/tournees',
        icon: MapPinned,
        feature: Feature.TOURNEES,
        roles: PLANNERS,
      },
      {
        key: 'orders',
        url: '/commandes',
        icon: ClipboardList,
        feature: Feature.TOURNEES,
        roles: [...PLANNERS, Role.SELLER, Role.STOREKEEPER],
      },
      {
        key: 'deliveries',
        url: '/livraisons',
        icon: PackageCheck,
        feature: Feature.TOURNEES,
        roles: [Role.LIVREUR, Role.SELLER],
      },
      {
        key: 'promotions',
        url: '/promotions',
        icon: BadgePercent,
        feature: Feature.PROMOTIONS,
        roles: [...PLANNERS, Role.SELLER],
      },
    ],
  },
  {
    key: 'groupStock',
    items: [
      { key: 'products', url: '/produits', icon: Package },
      { key: 'purchases', url: '/achats', icon: Truck },
      {
        key: 'importFiles',
        url: '/achats/dossiers',
        icon: Ship,
        feature: Feature.IMPORT_COSTS,
        roles: [Role.OWNER, Role.MANAGER],
      },
      { key: 'stock', url: '/stock', icon: Warehouse },
    ],
  },
  {
    key: 'groupManagement',
    items: [
      {
        key: 'flagged',
        url: '/operations-signalees',
        icon: MapPinCheck,
        feature: Feature.GEO_CHECK,
        roles: PLANNERS,
      },
      {
        key: 'incentives',
        url: '/primes',
        icon: Trophy,
        feature: Feature.INCENTIVES,
        roles: [Role.OWNER, Role.MANAGER],
      },
      // Phase 25, in every edition: anyone who may see the dépenses.
      {
        key: 'expenses',
        url: '/depenses',
        icon: Wallet,
        feature: Feature.EXPENSES,
        permission: Permission.EXPENSES_VIEW,
      },
      // Phase 31: managers of the DRH; "Mon pointage" only for a user with an employee file.
      {
        key: 'hr',
        url: '/rh',
        icon: UserCheck,
        feature: Feature.HR,
        permission: Permission.HR_VIEW,
      },
      { key: 'myAttendance', url: '/mon-pointage', icon: Fingerprint, feature: Feature.HR },
      { key: 'reports', url: '/rapports', icon: ChartColumn },
      { key: 'settings', url: '/parametres', icon: Settings },
    ],
  },
];

/** Flat list in menu order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * The menu of a company: items of modules it does not have are left out, then items of
 * other roles (when the role is known), then items needing a permission the user lacks
 * (when his permissions are known), then empty groups.
 */
export function visibleNavGroups(
  features: readonly Feature[],
  groups: readonly NavGroup[] = NAV_GROUPS,
  role?: Role,
  permissions?: readonly Permission[],
): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (item) =>
          (!item.feature || features.includes(item.feature)) &&
          (!item.roles || !role || item.roles.includes(role)) &&
          (!item.permission || !permissions || permissions.includes(item.permission)),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

const matches = (pathname: string, url: string) =>
  pathname === url || pathname.startsWith(`${url}/`);

/** The most specific item wins: /achats/dossiers is not also /achats. */
export function isActive(pathname: string, url: string): boolean {
  if (!matches(pathname, url)) return false;
  return !NAV_ITEMS.some(
    (i) => i.url.length > url.length && i.url.startsWith(`${url}/`) && matches(pathname, i.url),
  );
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.url));
}
