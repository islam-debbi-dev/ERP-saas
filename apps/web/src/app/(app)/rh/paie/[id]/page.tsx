import { PayrollRunPage } from '@/components/payroll/payroll-run-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayrollRunPage id={id} />;
}
