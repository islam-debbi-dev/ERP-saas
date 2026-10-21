import { ReportsPage } from '@/components/reports/reports-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.reports');

export default function RapportsPage() {
  return <ReportsPage />;
}
