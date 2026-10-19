'use client';

import { useTranslations } from 'next-intl';
import { Role } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { ImportHistory } from './import-history';
import { ImportWizard } from './import-wizard';

const IMPORTERS = new Set<string>([Role.OWNER, Role.MANAGER]);

export function ImportPage() {
  const t = useTranslations('imports');
  const { state } = useAuth();
  const role = state.status === 'authenticated' ? state.user.role : null;

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {role && !IMPORTERS.has(role) ? (
        <Alert>
          <AlertDescription>{t('forbidden')}</AlertDescription>
        </Alert>
      ) : (
        <>
          <ImportWizard />
          <ImportHistory />
        </>
      )}
    </>
  );
}
