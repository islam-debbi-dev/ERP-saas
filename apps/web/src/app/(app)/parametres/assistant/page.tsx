import { getTranslations } from 'next-intl/server';
import { TenantAiSettings } from '@/components/assistant/tenant-ai-settings';
import { PageHeader } from '@/components/shared/page-header';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('assistantSettings.title');

export default async function AssistantSettingsPage() {
  const t = await getTranslations('assistantSettings');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <TenantAiSettings />
    </>
  );
}
