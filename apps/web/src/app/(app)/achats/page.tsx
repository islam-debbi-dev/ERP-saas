import { PurchasesList } from '@/components/purchases/purchases-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.purchases');

export default function PurchasesPage() {
  return <PurchasesList />;
}
