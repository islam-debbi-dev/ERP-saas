'use client';

import { Settings } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { state } = useAuth();
  const name = state.status === 'authenticated' ? state.user.fullName : '';
  return (
    <PageHeader
      title={t('welcome', { name })}
      description={t('intro')}
      actions={
        <Button asChild>
          <Link href="/parametres">
            <Settings aria-hidden />
            {t('goToSettings')}
          </Link>
        </Button>
      }
    />
  );
}
