'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

/** Authenticated area. The API enforces auth; this only avoids showing an empty shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login');
  }, [state.status, router]);

  if (state.status !== 'authenticated') {
    return (
      <div
        className="flex min-h-dvh items-center justify-center text-muted-foreground"
        role="status"
      >
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="lg:flex">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-10">{children}</main>
    </div>
  );
}
