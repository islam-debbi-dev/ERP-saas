import { Suspense } from 'react';
import { DashboardPage } from '@/components/dashboard/dashboard-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.dashboard');

export default function TableauDeBordPage() {
  // The period and filters are in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <DashboardPage />
    </Suspense>
  );
}
