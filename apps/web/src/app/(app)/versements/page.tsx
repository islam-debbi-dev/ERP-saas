import { titled } from '@/lib/page-metadata';
import { ComingSoon } from '@/components/shared/coming-soon';

export const generateMetadata = titled('nav.versements');

export default function Page() {
  return <ComingSoon title="versements" />;
}
