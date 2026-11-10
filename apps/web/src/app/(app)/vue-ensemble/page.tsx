import { Suspense } from 'react';
import { OverviewPage } from '@/components/overview/overview-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.overview');

export default function VueEnsemblePage() {
  // OverviewPage reads ?from=&to= (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <OverviewPage />
    </Suspense>
  );
}
