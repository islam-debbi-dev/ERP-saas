import { titled } from '@/lib/page-metadata';
import { ComingSoon } from '@/components/shared/coming-soon';

export const generateMetadata = titled('nav.purchases');

export default function Page() {
  return <ComingSoon title="purchases" />;
}
