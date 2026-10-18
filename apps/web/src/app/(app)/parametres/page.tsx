import { getTranslations } from 'next-intl/server';
import { PriceLevelsCard } from '@/components/settings/price-levels-card';
import { SettingsForm } from '@/components/settings/settings-form';
import { PageHeader } from '@/components/shared/page-header';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <PriceLevelsCard />
      <SettingsForm />
    </>
  );
}
