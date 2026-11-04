'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'tabToday', href: '/rh/pointage' },
  { key: 'tabMonth', href: '/rh/mois' },
  { key: 'tabEmployees', href: '/rh/employes' },
  { key: 'tabLeaves', href: '/rh/conges' },
  { key: 'tabCalendar', href: '/rh/calendrier' },
] as const;

/** The DRH's sections. Scrolls inside itself on a phone, never the page. */
export function HrTabs() {
  const t = useTranslations('hr');
  const pathname = usePathname();
  return (
    <nav aria-label={t('title')} className="-mx-1 overflow-x-auto px-1">
      <ul className="flex w-max gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
