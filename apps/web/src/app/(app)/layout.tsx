'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type CSSProperties, useEffect } from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { SiteHeader } from '@/components/layout/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useAuth } from '@/lib/auth';

/** Authenticated area. The API enforces auth; this only avoids showing an empty shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login');
  }, [state.status, router]);

  if (state.status !== 'authenticated') {
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

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 64)',
          '--header-height': 'calc(var(--spacing) * 14)',
        } as CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-muted/30">
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
