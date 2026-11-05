import { PayrollListPage } from '@/components/payroll/payroll-list-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <PayrollListPage />;
}
