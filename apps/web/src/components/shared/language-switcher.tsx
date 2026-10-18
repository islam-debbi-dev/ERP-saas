'use client';

import { Languages, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type AppLocale,
  dirFor,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  LOCALE_SHORT,
  LOCALES,
} from '@/i18n/config';
import { cn } from '@/lib/utils';

/** Saves the choice for the server and flips direction right away (before the refresh lands). */
function persistLocale(next: AppLocale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  document.documentElement.lang = next;
  document.documentElement.dir = dirFor(next);
}

/** Writes the NEXT_LOCALE cookie and re-renders the server components in the new language. */
export function LanguageSwitcher({
  className,
  variant = 'ghost',
  showLabel = false,
}: {
  className?: string;
  variant?: 'ghost' | 'outline';
  showLabel?: boolean;
}) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setLocale = (next: AppLocale) => {
    if (next === locale) return;
    persistLocale(next);
    startTransition(() => router.refresh());
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className={cn('gap-2', className)}
          aria-label={t('language')}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Languages className="size-4" aria-hidden />
          )}
          <span className="text-xs font-medium">{LOCALE_SHORT[locale]}</span>
          {showLabel ? (
            <span className="hidden text-sm sm:inline">{LOCALE_LABELS[locale]}</span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => setLocale(option)}
            className={cn('justify-between', option === locale && 'bg-accent font-medium')}
          >
            {LOCALE_LABELS[option]}
            <span className="text-xs text-muted-foreground">{LOCALE_SHORT[option]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
