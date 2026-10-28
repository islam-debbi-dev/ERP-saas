'use client';

import { Eye, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { impersonation } from '@/lib/impersonation';

/**
 * Landing of a super-admin's read-only view. The admin area opens
 * `/support#token=…` in a new tab: the token (never sent to a server in the URL)
 * moves to this tab's sessionStorage, then the app reloads on the dashboard.
 */
export function SupportLanding({ ended }: { ended: boolean }) {
  const t = useTranslations('support');
  const [state, setState] = useState<'opening' | 'ended' | 'missing'>('opening');

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (token) {
      impersonation.set(token);
      window.history.replaceState(null, '', '/support');
      // Full load: the auth provider starts again with the support token.
      window.location.replace('/tableau-de-bord');
      return;
    }
    queueMicrotask(() => setState(ended ? 'ended' : 'missing'));
  }, [ended]);

  return (
    <AuthCard
      title={t('title')}
      description={
        state === 'opening' ? t('opening') : state === 'ended' ? t('ended') : t('missing')
      }
    >
      {state === 'opening' ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('opening')}
        </div>
      ) : state === 'ended' ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('endedHelp')}
        </p>
      ) : null}
    </AuthCard>
  );
}
