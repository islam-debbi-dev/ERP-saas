import { TodayScreen } from '@/components/tournees/today-screen';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('tournees.todayTitle');

export default function TodayPage() {
  return <TodayScreen />;
}
