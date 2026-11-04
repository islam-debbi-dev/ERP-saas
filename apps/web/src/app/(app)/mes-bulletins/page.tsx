import { MyPayslipsPage } from '@/components/payroll/my-payslips-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.myPayslips');

export default function Page() {
  return <MyPayslipsPage />;
}
