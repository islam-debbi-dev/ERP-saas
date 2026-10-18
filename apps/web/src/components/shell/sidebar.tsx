'use client';

import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item, i) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={t('nav.shortcutHint', { key: i + 1 })}
              className={cn(
                'group relative flex h-10 items-center gap-3 rounded-md px-3 text-[0.9375rem] transition-colors',
                active
                  ? 'bg-accent font-medium text-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-carbon'
                  : 'text-ink/80 hover:bg-secondary hover:text-ink',
              )}
            >
              <Icon className="size-[1.125rem] shrink-0" aria-hidden="true" />
              <span className="flex-1">{t(item.label)}</span>
              <kbd className="num hidden rounded border border-border bg-card px-1.5 text-xs text-muted-foreground group-hover:inline lg:group-focus-visible:inline">
                {i + 1}
              </kbd>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserBlock() {
  const { state, logout } = useAuth();
  const router = useRouter();
  if (state.status !== 'authenticated') return null;
  return (
    <div className="border-t pt-3">
      <p className="truncate px-3 text-sm font-medium">{state.user.fullName}</p>
      <p className="truncate px-3 text-sm text-muted-foreground">{state.user.tenantName}</p>
      <Button
        variant="ghost"
        className="mt-2 w-full justify-start px-3 text-ink/80"
        onClick={() => void logout().then(() => router.replace('/login'))}
      >
        <LogOut aria-hidden="true" />
        {t('nav.logout')}
      </Button>
    </div>
  );
}

/** Alt + 1…8 jumps to a module. Uses `code` so it works with AZERTY and macOS Option. */
function useNavShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const match = /^Digit([1-9])$/.exec(e.code);
      const item = match ? NAV_ITEMS[Number(match[1]) - 1] : undefined;
      if (!item) return;
      e.preventDefault();
      router.push(item.href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useNavShortcuts();

  // Close the drawer on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card px-4 lg:hidden">
        <span className="font-semibold">{t('app.name')}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.openMenu')}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
      </header>

      {open ? (
        <div
          className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <nav
        id="sidebar"
        aria-label={t('nav.label')}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card px-3 py-4 transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex items-center justify-between px-3">
          <Link href="/tableau-de-bord" className="font-semibold">
            {t('app.name')}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('nav.closeMenu')}
            onClick={() => setOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavList key={pathname} onNavigate={() => setOpen(false)} />
        </div>
        <UserBlock />
      </nav>
    </>
  );
}
