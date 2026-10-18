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
import type { MessageKey } from '@/lib/i18n';

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
}

/** Order = Alt+1 … Alt+8 shortcuts. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/tableau-de-bord', label: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/produits', label: 'nav.products', icon: Package },
  { href: '/achats', label: 'nav.purchases', icon: Truck },
  { href: '/ventes', label: 'nav.sales', icon: ReceiptText },
  { href: '/clients', label: 'nav.clients', icon: Users },
  { href: '/versements', label: 'nav.versements', icon: Banknote },
  { href: '/stock', label: 'nav.stock', icon: Warehouse },
  { href: '/parametres', label: 'nav.settings', icon: Settings },
];
