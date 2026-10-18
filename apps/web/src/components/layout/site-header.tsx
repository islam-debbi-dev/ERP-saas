'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { currentNavItem } from './navigation';

/** Sticky bar: sidebar trigger, current section, language and theme. */
export function SiteHeader() {
  const t = useTranslations('nav');
  const current = currentNavItem(usePathname());

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <SidebarTrigger className="-ms-1" aria-label={t('toggleSidebar')} />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {current ? t(current.key) : null}
      </p>
      <LanguageSwitcher variant="ghost" showLabel />
      <ThemeToggle />
    </header>
  );
}
