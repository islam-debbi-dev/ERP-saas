'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const subscribe = () => () => {};

/** Light / dark / system, stored by next-themes. */
export function ThemeToggle() {
  const t = useTranslations('nav');
  const { setTheme, resolvedTheme } = useTheme();
  // false during server render and hydration, true after: avoids an icon mismatch.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme')}>
          {mounted && resolvedTheme === 'dark' ? <Moon aria-hidden /> : <Sun aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme('light')}>{t('themeLight')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>{t('themeDark')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>{t('themeSystem')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
