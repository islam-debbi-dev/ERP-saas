import { Suspense } from 'react';
import { VersementsPage } from '@/components/payments/versements-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.versements');

export default function Page() {
  // VersementsPage keeps its filters in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <VersementsPage />
    </Suspense>
  );
}
