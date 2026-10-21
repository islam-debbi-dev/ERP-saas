import { titled } from '@/lib/page-metadata';
import { getTranslations } from 'next-intl/server';
import { AdminLinksCard } from '@/components/settings/admin-links-card';
import { ImportLinkCard } from '@/components/settings/import-link-card';
import { PriceLevelsCard } from '@/components/settings/price-levels-card';
import { SettingsForm } from '@/components/settings/settings-form';
import { PageHeader } from '@/components/shared/page-header';

export const generateMetadata = titled('nav.settings');

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <AdminLinksCard />
      <ImportLinkCard />
      <PriceLevelsCard />
      <SettingsForm />
    </>
  );
}
