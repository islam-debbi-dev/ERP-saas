import { ClientsToRemind } from '@/components/clients/clients-to-remind';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('reminders.title');

export default function ClientsToRemindPage() {
  return <ClientsToRemind />;
}
