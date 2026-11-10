import { Suspense } from 'react';
import { PurchasesList } from '@/components/purchases/purchases-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.purchases');

export default function PurchasesPage() {
  // PurchasesList keeps its filters in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <PurchasesList />
    </Suspense>
  );
}
