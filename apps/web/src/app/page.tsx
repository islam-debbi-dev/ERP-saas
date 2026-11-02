'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useHomePath } from '@/lib/overview';

/**
 * Where a user lands: the Vue d'ensemble when he sees more than one dépôt (phase 26),
 * else the dashboard. Signed out, the dashboard's layout sends him to the login.
 */
export default function Home() {
  const t = useTranslations('common');
  const { state } = useAuth();
  const home = useHomePath();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/tableau-de-bord');
    else if (home) router.replace(home);
  }, [state.status, home, router]);

  return (
    <div
      className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t('loading')}
    </div>
  );
}
