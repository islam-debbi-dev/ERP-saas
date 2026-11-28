import { ZonesPage } from '@/components/zones/zones-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('zones.title');

export default function Page() {
  return <ZonesPage />;
}
