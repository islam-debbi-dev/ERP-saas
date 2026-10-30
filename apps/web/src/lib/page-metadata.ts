import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

type TitleKey =
  | 'nav.dashboard'
  | 'nav.products'
  | 'nav.purchases'
  | 'nav.sales'
  | 'nav.clients'
  | 'nav.versements'
  | 'nav.stock'
  | 'nav.reports'
  | 'nav.settings'
  | 'imports.title'
  | 'users.title'
  | 'sessions.title'
  | 'audit.title'
  | 'products.newTitle'
  | 'products.editTitle'
  | 'categories.title'
  | 'brands.title'
  | 'sectors.title'
  | 'stock.inventories'
  | 'warehouses.title'
  | 'transfers.title'
  | 'purchases.newTitle'
  | 'purchases.editTitle'
  | 'suppliers.title'
  | 'clients.newTitle'
  | 'clients.editTitle'
  | 'clients.detailTitle'
  | 'sales.newTitle'
  | 'sales.detailTitle'
  | 'billing.title'
  | 'admin.tenants'
  | 'admin.loginTitle'
  | 'support.title'
  | 'supplierAccount.title'
  | 'aging.title'
  | 'reminders.title'
  | 'tournees.title'
  | 'tournees.todayTitle'
  | 'tournees.closingTitle'
  | 'tournees.reportTitle'
  | 'orders.title'
  | 'orders.orderOne'
  | 'orders.deliveriesTitle'
  | 'geo.title';

/** `export const generateMetadata = titled('nav.products')` gives the tab a translated title. */
export function titled(key: TitleKey): () => Promise<Metadata> {
  return async () => {
    const t = await getTranslations();
    return { title: t(key) };
  };
}
