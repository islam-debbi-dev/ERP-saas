'use client';

import { EllipsisVertical, Loader2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { LanguageSwitcher, useLocaleSwitch } from '@/components/shared/language-switcher';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { type AppLocale, LOCALE_LABELS, LOCALES } from '@/i18n/config';
import { currentNavItem } from './navigation';

const THEMES = ['light', 'dark', 'system'] as const;
const THEME_LABEL = { light: 'themeLight', dark: 'themeDark', system: 'themeSystem' } as const;

/** Phone: language and theme in one menu, so the title keeps the width. */
function HeaderMenu() {
  const t = useTranslations('nav');
  const { locale, setLocale, pending } = useLocaleSwitch();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('moreOptions')}>
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <EllipsisVertical aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as AppLocale)}>
          {LOCALES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} className="min-h-11">
              {LOCALE_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
          {THEMES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} className="min-h-11">
              {t(THEME_LABEL[option])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sticky bar: sidebar trigger, current section, language and theme. */
export function SiteHeader() {
  const t = useTranslations('nav');
  const current = currentNavItem(usePathname());

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 ps-2 pe-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:gap-2 md:px-4 lg:px-6">
      <SidebarTrigger className="size-11 md:-ms-1 md:size-7" aria-label={t('toggleSidebar')} />
      <Separator orientation="vertical" className="mx-1 hidden h-4 md:block" />
      <p className="min-w-0 flex-1 truncate text-base font-medium md:text-sm">
        {current ? t(current.key) : null}
      </p>
      <div className="hidden items-center gap-1 md:flex">
        <LanguageSwitcher variant="ghost" showLabel />
        <ThemeToggle />
      </div>
      <div className="md:hidden">
        <HeaderMenu />
      </div>
    </header>
  );
}
