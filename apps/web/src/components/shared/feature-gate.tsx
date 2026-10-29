'use client';

import { ArrowLeft, LockKeyhole, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { editionsWith, type Feature } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { useAuth, useFeature } from '@/lib/auth';
import { whatsappLink } from '@/lib/support';
import { EmptyState } from './empty-state';

/**
 * Wraps the page of a module outside the core (phase 13b). Without the module, a direct
 * URL shows which edition has it and how to ask for it, instead of a page whose every
 * call would answer FEATURE_NOT_IN_PLAN.
 */
export function FeatureGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const enabled = useFeature(feature);
  const { state } = useAuth();
  // Until /auth/me is back, show nothing rather than flashing the locked screen.
  if (state.status !== 'authenticated') return null;
  return enabled ? <>{children}</> : <FeatureLocked feature={feature} />;
}

export function FeatureLocked({ feature }: { feature: Feature }) {
  const t = useTranslations('features');
  const { state } = useAuth();
  const name = t(`feature${feature}`);
  const editions = editionsWith(feature)
    .map((e) => t(`edition${e}`))
    .join(t('or'));
  const company = state.status === 'authenticated' ? state.user.tenantName : '';
  const whatsapp = whatsappLink(t('lockedWhatsappMessage', { feature: name, company }));

  return (
    <EmptyState
      icon={LockKeyhole}
      title={t('lockedTitle')}
      description={t('lockedBody', { feature: name, editions })}
    >
      <div className="flex w-full max-w-sm flex-col gap-2 sm:w-auto sm:flex-row">
        {whatsapp ? (
          <Button asChild className="min-h-11">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden />
              {t('lockedContact')}
            </a>
          </Button>
        ) : null}
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/tableau-de-bord">
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
            {t('lockedBack')}
          </Link>
        </Button>
      </div>
    </EmptyState>
  );
}
