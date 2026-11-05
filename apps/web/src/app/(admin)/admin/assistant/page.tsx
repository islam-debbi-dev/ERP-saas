import { AdminAssistantPage } from '@/components/admin/admin-assistant-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('assistantSettings.title');

export default function Page() {
  return <AdminAssistantPage />;
}
