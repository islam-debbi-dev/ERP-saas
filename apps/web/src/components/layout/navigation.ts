import {
  Banknote,
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
import type { Feature } from '@erp/shared';

export type NavKey =
  | 'dashboard'
  | 'sales'
  | 'versements'
  | 'clients'
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
}

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

/** The menu of a company: items of modules it does not have are left out, then empty groups. */
export function visibleNavGroups(
  features: readonly Feature[],
  groups: readonly NavGroup[] = NAV_GROUPS,
): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.feature || features.includes(item.feature)),
    }))
    .filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, url: string): boolean {
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.url));
}
