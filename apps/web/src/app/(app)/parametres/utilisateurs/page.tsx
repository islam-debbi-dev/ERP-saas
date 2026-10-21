import { UsersPage } from '@/components/users/users-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('users.title');

export default function Page() {
  return <UsersPage />;
}
