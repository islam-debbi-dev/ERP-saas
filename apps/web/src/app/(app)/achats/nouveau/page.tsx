import { Suspense } from 'react';
import { PurchasePage } from '@/components/purchases/purchase-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('purchases.newTitle');

export default function NewPurchasePage() {
  // PurchasePage reads ?dossier= (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <PurchasePage id={null} />
    </Suspense>
  );
}
