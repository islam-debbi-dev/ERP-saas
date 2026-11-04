import { MyAttendancePage } from '@/components/hr/my-attendance-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.myAttendance');

export default function Page() {
  return <MyAttendancePage />;
}
