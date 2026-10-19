import { VersementsPage } from '@/components/payments/versements-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.versements');

export default function Page() {
  return <VersementsPage />;
}
