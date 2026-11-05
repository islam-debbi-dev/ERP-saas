import { AdminAssistantUsagePage } from '@/components/admin/admin-assistant-usage-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('assistantSettings.usage');

export default function Page() {
  return <AdminAssistantUsagePage />;
}
