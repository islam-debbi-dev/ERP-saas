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
  | 'nav.settings'
  | 'products.newTitle'
  | 'products.editTitle'
  | 'categories.title'
  | 'stock.inventories'
  | 'purchases.newTitle'
  | 'purchases.editTitle'
  | 'suppliers.title'
  | 'clients.newTitle'
  | 'clients.editTitle'
  | 'clients.detailTitle';

/** `export const generateMetadata = titled('nav.products')` gives the tab a translated title. */
export function titled(key: TitleKey): () => Promise<Metadata> {
  return async () => {
    const t = await getTranslations();
    return { title: t(key) };
  };
}
