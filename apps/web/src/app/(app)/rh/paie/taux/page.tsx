import { PayrollRatesPage } from '@/components/payroll/payroll-rates-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <PayrollRatesPage />;
}
