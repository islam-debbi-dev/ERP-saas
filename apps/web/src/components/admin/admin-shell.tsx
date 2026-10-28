'use client';

import { Loader2, LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Button } from '@/components/ui/button';
import { AdminAuthProvider, useAdminAuth } from '@/lib/admin';

/** The super-admin area: its own session, its own header, no company sidebar. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <Frame>{children}</Frame>
    </AdminAuthProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { state, logout } = useAdminAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === '/admin/login';

  useEffect(() => {
    if (state.status === 'anonymous' && !onLogin) router.replace('/admin/login');
    if (state.status === 'authenticated' && onLogin) router.replace('/admin');
  }, [state.status, onLogin, router]);

  if (onLogin) {
    return (
      <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 pt-20 pb-6 md:p-10">
        <div className="absolute end-2 top-2 flex items-center gap-1 md:end-4 md:top-4">
          <LanguageSwitcher variant="ghost" showLabel />
          <ThemeToggle />
        </div>
        <main className="flex w-full max-w-md flex-col gap-6">{children}</main>
      </div>
    );
  }

  if (state.status !== 'authenticated') {
    return (
      <div
        className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link
            href="/admin"
            className="flex min-w-0 flex-1 items-center gap-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{t('admin.area')}</span>
          </Link>
          <LanguageSwitcher variant="ghost" />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t('admin.logout')}
            onClick={() => void logout().then(() => router.replace('/admin/login'))}
          >
            <LogOut className="rtl:rotate-180" aria-hidden />
          </Button>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 lg:p-6">{children}</main>
    </div>
  );
}
