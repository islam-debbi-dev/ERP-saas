import { TreasuryPage } from '@/components/treasury/treasury-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.treasury');

export default function Page() {
  return <TreasuryPage />;
}
