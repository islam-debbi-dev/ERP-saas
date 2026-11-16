import { Suspense } from 'react';
import { StatisticsPage } from '@/components/statistics/statistics-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.statistics');

export default function StatistiquesPage() {
  // The filters live in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <StatisticsPage />
    </Suspense>
  );
}
