import { EmployeesPage } from '@/components/hr/employees-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <EmployeesPage />;
}
