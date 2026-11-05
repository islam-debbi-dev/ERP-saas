import { PayrollSettingsPage } from '@/components/payroll/payroll-settings-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <PayrollSettingsPage />;
}
