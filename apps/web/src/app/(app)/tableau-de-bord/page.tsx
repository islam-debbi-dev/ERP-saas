'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

export default function DashboardPage() {
  const { state } = useAuth();
  const name = state.status === 'authenticated' ? state.user.fullName : '';
  return (
    <>
      <PageHeader title={t('dashboard.welcome', { name })} description={t('dashboard.intro')} />
      <Button asChild variant="outline">
        <Link href="/parametres">{t('dashboard.goToSettings')}</Link>
      </Button>
    </>
  );
}
