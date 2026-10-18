import { DashboardWelcome } from '@/components/dashboard/dashboard-welcome';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.dashboard');

export default function DashboardPage() {
  return <DashboardWelcome />;
}
