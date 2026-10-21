import { Suspense } from 'react';
import { StockLevels } from '@/components/stock/stock-levels';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.stock');

export default function StockPage() {
  // StockLevels reads ?filtre= (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <StockLevels />
    </Suspense>
  );
}
