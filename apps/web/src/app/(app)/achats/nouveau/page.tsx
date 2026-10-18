import { PurchasePage } from '@/components/purchases/purchase-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('purchases.newTitle');

export default function NewPurchasePage() {
  return <PurchasePage id={null} />;
}
