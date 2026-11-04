'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePayrollOn } from '@/lib/payroll';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'tabToday', href: '/rh' },
  { key: 'tabMonth', href: '/rh/mois' },
  { key: 'tabEmployees', href: '/rh/employes' },
  { key: 'tabLeaves', href: '/rh/conges' },
  { key: 'tabCalendar', href: '/rh/calendrier' },
  { key: 'tabPayroll', href: '/rh/paie' },
] as const;

/** The DRH's sections. They wrap on a phone: a tab hidden to the side is never found. */
export function HrTabs() {
  const t = useTranslations('hr');
  const pathname = usePathname();
  const payroll = usePayrollOn();
  const tabs = TABS.filter((tab) => payroll || tab.key !== 'tabPayroll');
  return (
    <nav aria-label={t('title')}>
      <ul className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          // `/rh` is the Pointage: only its own path, not every section under it.
          const active =
            pathname === tab.href || (tab.href !== '/rh' && pathname.startsWith(`${tab.href}/`));
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
