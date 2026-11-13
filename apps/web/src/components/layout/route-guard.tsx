'use client';

import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { useAuth, useFeatures } from '@/lib/auth';
import { routeForbidden } from './navigation';

/**
 * The page-level twin of the menu: a URL whose menu item is hidden from this user shows
 * "réservé" instead of the screen. Display only, like the menu: the API is what protects
 * the data, and it already answered 403, 404 or an empty list on those pages. Without
 * this, a livreur who typed /tournees got the planners' screen with "Nouvelle tournée".
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const features = useFeatures();
  const { state } = useAuth();
  if (state.status !== 'authenticated') return <>{children}</>;
  if (!routeForbidden(pathname, features, state.user.role, state.user.permissions)) {
    return <>{children}</>;
  }
  return (
    <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')}>
      <Button asChild variant="outline" className="min-h-11">
        <Link href="/">
          <ArrowLeft className="rtl:rotate-180" aria-hidden />
          {t('forbiddenBack')}
        </Link>
      </Button>
    </EmptyState>
  );
}
