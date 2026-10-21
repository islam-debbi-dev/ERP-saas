import { DashboardPage } from '@/components/dashboard/dashboard-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.dashboard');

export default function TableauDeBordPage() {
  return <DashboardPage />;
}
