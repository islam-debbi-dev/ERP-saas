import { PointagePage } from '@/components/hr/pointage-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <PointagePage />;
}
