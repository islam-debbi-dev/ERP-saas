import {
  Banknote,
  ClipboardList,
  MapPinned,
  Navigation,
  PackageCheck,
  ChartColumn,
  LayoutDashboard,
  type LucideIcon,
  Package,
  ReceiptText,
  Settings,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { Feature, Role } from '@erp/shared';

export type NavKey =
  | 'dashboard'
  | 'sales'
  | 'versements'
  | 'clients'
  | 'today'
  | 'tournees'
  | 'orders'
  | 'deliveries'
  | 'products'
  | 'purchases'
  | 'stock'
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
    ],
  },
  {
    key: 'groupStock',
    items: [
      { key: 'products', url: '/produits', icon: Package },
      { key: 'purchases', url: '/achats', icon: Truck },
      { key: 'stock', url: '/stock', icon: Warehouse },
    ],
  },
  {
    key: 'groupManagement',
    items: [
      { key: 'reports', url: '/rapports', icon: ChartColumn },
      { key: 'settings', url: '/parametres', icon: Settings },
    ],
  },
];

/** Flat list in menu order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * The menu of a company: items of modules it does not have are left out, then items of
 * other roles (when the role is known), then empty groups.
 */
export function visibleNavGroups(
  features: readonly Feature[],
  groups: readonly NavGroup[] = NAV_GROUPS,
  role?: Role,
): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (item) =>
          (!item.feature || features.includes(item.feature)) &&
          (!item.roles || !role || item.roles.includes(role)),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, url: string): boolean {
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.url));
}
