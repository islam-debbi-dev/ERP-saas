import { SessionsPage } from '@/components/users/sessions-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('sessions.title');

export default function Page() {
  return <SessionsPage />;
}
