import { CalendarPage } from '@/components/hr/calendar-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.hr');

export default function Page() {
  return <CalendarPage />;
}
