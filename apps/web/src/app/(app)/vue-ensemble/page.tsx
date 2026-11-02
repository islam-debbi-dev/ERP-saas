import { OverviewPage } from '@/components/overview/overview-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.overview');

export default function VueEnsemblePage() {
  return <OverviewPage />;
}
