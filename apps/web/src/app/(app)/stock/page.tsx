import { titled } from '@/lib/page-metadata';
import { ComingSoon } from '@/components/shared/coming-soon';

export const generateMetadata = titled('nav.stock');

export default function Page() {
  return <ComingSoon title="stock" />;
}
