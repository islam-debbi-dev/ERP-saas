import { LeavesPage } from '@/components/hr/leaves-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <LeavesPage />;
}
