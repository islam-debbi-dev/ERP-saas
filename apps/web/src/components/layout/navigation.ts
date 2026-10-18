import {
  Banknote,
  LayoutDashboard,
  type LucideIcon,
  Package,
  ReceiptText,
  Settings,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';

export type NavKey =
  | 'dashboard'
  | 'sales'
  | 'versements'
  | 'clients'
  | 'products'
  | 'purchases'
  | 'stock'
  | 'settings';

export interface NavItem {
  key: NavKey;
  url: string;
  icon: LucideIcon;
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
    items: [{ key: 'settings', url: '/parametres', icon: Settings }],
  },
];

/** Flat list in menu order: Alt+1 … Alt+8 follow it. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isActive(pathname: string, url: string): boolean {
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.url));
}
