'use client';

import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** A secondary page action: a button from `md` up, a menu item on a phone. */
export type PageAction = {
  label: string;
  icon: LucideIcon;
  /** Flips in RTL (arrows, chevrons). */
  flipIcon?: boolean;
  /** `ghost` for "back", `destructive` for cancel / archive. Default: outline. */
  tone?: 'ghost' | 'destructive';
  disabled?: boolean;
} & ({ href: string; onSelect?: never } | { onSelect: () => void; href?: never });

function MoreMenu({ items }: { items: PageAction[] }) {
  const t = useTranslations('nav');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('moreOptions')}>
          <EllipsisVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {items.map(({ label, icon: Icon, flipIcon, tone, disabled, ...action }) =>
          action.href ? (
            <DropdownMenuItem key={label} asChild className="min-h-11" disabled={disabled}>
              <Link href={action.href}>
                <Icon className={cn(flipIcon && 'rtl-flip')} aria-hidden />
                {label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={label}
              className="min-h-11"
              variant={tone === 'destructive' ? 'destructive' : 'default'}
              disabled={disabled}
              onSelect={action.onSelect}
            >
              <Icon aria-hidden />
              {label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Title + description + actions, the top of every page. `actions` are always
 * shown; `more` are secondary actions that fold into one menu on a phone, so
 * the header never turns into a wall of buttons at 360 px.
 */
export function PageHeader({
  title,
  description,
  actions,
  more,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Falsy entries are skipped, so conditional actions can be written inline. */
  more?: (PageAction | false | null | undefined)[];
  className?: string;
}) {
  const secondary = (more ?? []).filter((a): a is PageAction => Boolean(a));
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions || secondary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {secondary.map(({ label, icon: Icon, flipIcon, tone, disabled, ...action }) =>
            action.href ? (
              <Button
                key={label}
                asChild
                variant={tone ? 'ghost' : 'outline'}
                className="max-md:hidden"
              >
                <Link href={action.href}>
                  <Icon className={cn(flipIcon && 'rtl-flip')} aria-hidden />
                  {label}
                </Link>
              </Button>
            ) : (
              <Button
                key={label}
                variant={tone ? 'ghost' : 'outline'}
                className={cn('max-md:hidden', tone === 'destructive' && 'text-destructive')}
                disabled={disabled}
                onClick={action.onSelect}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ),
          )}
          {actions ? (
            <div className="flex flex-1 flex-wrap items-center gap-2 sm:flex-none [&>*]:max-md:flex-1">
              {actions}
            </div>
          ) : null}
          {secondary.length > 0 ? (
            <div className="md:hidden">
              <MoreMenu items={secondary} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
