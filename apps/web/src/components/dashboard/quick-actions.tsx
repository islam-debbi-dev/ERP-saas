'use client';

import { Banknote, type LucideIcon, Plus, ReceiptText, Truck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Permission } from '@erp/shared';
import { useCanOpen } from '@/components/layout/use-visible-nav';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { useAuth } from '@/lib/auth';

interface QuickAction {
  key: 'quickNewSale' | 'quickVersement' | 'quickPurchase' | 'quickNewClient';
  href: string;
  icon: LucideIcon;
  permission: Permission;
}

const ACTIONS: readonly QuickAction[] = [
  {
    key: 'quickNewSale',
    href: '/ventes/nouvelle',
    icon: ReceiptText,
    permission: Permission.SALES_CREATE,
  },
  {
    key: 'quickVersement',
    href: '/versements?nouveau=1',
    icon: Banknote,
    permission: Permission.PAYMENTS_CREATE,
  },
  {
    key: 'quickPurchase',
    href: '/achats/nouveau',
    icon: Truck,
    permission: Permission.PURCHASES_CREATE,
  },
  {
    key: 'quickNewClient',
    href: '/clients/nouveau',
    icon: UserPlus,
    permission: Permission.CLIENTS_CREATE,
  },
];

/** The actions this user may start: his permission and a page he can open. */
function useQuickActions(): QuickAction[] {
  const permissions = useAuth().state.user?.permissions ?? [];
  const canOpen = useCanOpen();
  return ACTIONS.filter((a) => permissions.includes(a.permission) && canOpen(a.href));
}

/** Desktop: a row of buttons in the page header (the phone has the "+" button). */
export function QuickActionButtons() {
  const t = useTranslations('dashboard');
  const actions = useQuickActions();
  if (actions.length === 0) return null;
  return (
    <div className="hidden flex-wrap gap-2 md:flex" role="group" aria-label={t('quickActions')}>
      {actions.map((a, n) => (
        <Button key={a.key} asChild variant={n === 0 ? 'default' : 'outline'}>
          <Link href={a.href}>
            <a.icon aria-hidden />
            {t(a.key)}
          </Link>
        </Button>
      ))}
    </div>
  );
}

/**
 * Phone: one round "+" at the bottom end, above the home indicator, opening a sheet of big
 * tiles. Only on the dashboard, so it never covers another page's sticky actions.
 */
export function QuickActionFab() {
  const t = useTranslations('dashboard');
  const actions = useQuickActions();
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <>
      <Button
        size="icon"
        className="fixed end-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-lg md:hidden [&_svg:not([class*='size-'])]:size-6"
        aria-label={t('quickOpen')}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden />
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="md:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('quickActions')}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ul className="grid grid-cols-2 gap-3 pb-[env(safe-area-inset-bottom)]">
            {actions.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-center text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
                >
                  <a.icon className="size-6 text-primary" aria-hidden />
                  {t(a.key)}
                </Link>
              </li>
            ))}
          </ul>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
