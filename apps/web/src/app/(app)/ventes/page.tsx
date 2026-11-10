import { Suspense } from 'react';
import { SalesList } from '@/components/sales/sales-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.sales');

export default function SalesPage() {
  // SalesList keeps its filters in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <SalesList />
    </Suspense>
  );
}
