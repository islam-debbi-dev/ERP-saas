import { MonthPage } from '@/components/hr/month-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <MonthPage />;
}
