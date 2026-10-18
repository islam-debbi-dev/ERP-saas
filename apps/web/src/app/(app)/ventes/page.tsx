import { titled } from '@/lib/page-metadata';
import { ComingSoon } from '@/components/shared/coming-soon';

export const generateMetadata = titled('nav.sales');

export default function Page() {
  return <ComingSoon title="sales" />;
}
