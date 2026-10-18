import { SettingsForm } from '@/components/settings/settings-form';
import { PageHeader } from '@/components/shell/page-header';
import { t } from '@/lib/i18n';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <SettingsForm />
    </>
  );
}
