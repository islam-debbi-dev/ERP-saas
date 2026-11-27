'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import { filterOptions, type LocationOption } from '@/lib/locations';
import { cn } from '@/lib/utils';

interface OptionFieldProps {
  label: string;
  /** What the closed field shows; the placeholder when nothing is chosen. */
  value?: string | null;
  placeholder: string;
  options: LocationOption[];
  selectedIds: string[];
  /** One choice: called and the list closes. Several: called on each tap, the list stays. */
  onPick: (id: string) => void;
  multiple?: boolean;
  /** Several choices only: no more can be added. */
  full?: boolean;
  disabled?: boolean;
  /** A first row that clears this level, such as "all daïras". */
  emptyOption?: { label: string; onPick: () => void };
}

/**
 * A field that opens a searchable list in the shared dialog (bottom sheet on a phone).
 * Rows are 44 px or more and wrap, so a long name is always readable in full.
 */
export function OptionField({ label, value, placeholder, disabled, ...list }: OptionFieldProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 space-y-2">
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-labelledby={`${id}-label ${id}-value`}
            className="h-auto min-h-11 w-full justify-between whitespace-normal py-2 text-start text-base font-normal md:h-auto md:text-sm"
          >
            <span
              id={`${id}-value`}
              dir="auto"
              className={cn('min-w-0 break-words', !value && 'text-muted-foreground')}
            >
              {value || placeholder}
            </span>
            <ChevronDown className="text-muted-foreground" aria-hidden />
          </Button>
        </ResponsiveDialogTrigger>
        {open ? <OptionList title={label} {...list} onClose={() => setOpen(false)} /> : null}
      </ResponsiveDialog>
    </div>
  );
}

function OptionList({
  title,
  options,
  selectedIds,
  onPick,
  multiple,
  full,
  emptyOption,
  onClose,
}: Omit<OptionFieldProps, 'label' | 'value' | 'placeholder' | 'disabled'> & {
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations('locations');
  const [query, setQuery] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const found = filterOptions(options, query);
  const selected = new Set(selectedIds);
  const row =
    'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-start text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return (
    <ResponsiveDialogContent
      ref={content}
      aria-describedby={undefined}
      // A fixed height: the sheet does not jump while the search narrows the list.
      className="h-[92svh] gap-3 overflow-hidden md:h-[min(36rem,90svh)] md:max-w-md"
      onOpenAutoFocus={(e) => {
        // On a touch screen the keyboard would hide the list: it opens when asked.
        if (window.matchMedia?.('(pointer: coarse)').matches) {
          e.preventDefault();
          content.current?.focus();
        }
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
      </ResponsiveDialogHeader>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          dir="auto"
          autoComplete="off"
          aria-label={t('search')}
          placeholder={t('search')}
          className="h-11 ps-9 md:h-11"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Inside a form, Enter must not save it.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        />
      </div>
      <ul className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1">
        {emptyOption && !query ? (
          <li>
            <button
              type="button"
              className={cn(row, 'font-medium hover:bg-accent active:bg-accent')}
              onClick={() => {
                emptyOption.onPick();
                onClose();
              }}
            >
              <span className="size-5 shrink-0" aria-hidden />
              {emptyOption.label}
            </button>
          </li>
        ) : null}
        {found.map((option) => {
          const on = selected.has(option.id);
          const off = option.disabledReason !== undefined || (full && !on);
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={off}
                className={cn(
                  row,
                  on ? 'bg-accent font-medium' : 'hover:bg-accent active:bg-accent',
                  off && 'cursor-not-allowed hover:bg-transparent',
                )}
                onClick={() => {
                  onPick(option.id);
                  if (!multiple) onClose();
                }}
              >
                <Check className={cn('size-5 shrink-0', !on && 'invisible')} aria-hidden />
                <span className="min-w-0 break-words">
                  <span dir="auto" className={cn('block', off && 'text-muted-foreground')}>
                    {option.label}
                  </span>
                  {option.disabledReason ? (
                    <span className="block text-xs text-muted-foreground">
                      {option.disabledReason}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
        {found.length === 0 ? (
          <li role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('noResult')}
          </li>
        ) : null}
      </ul>
      {multiple ? (
        <ResponsiveDialogFooter>
          <Button type="button" className="min-h-11" onClick={onClose}>
            {t('done', { count: selected.size })}
          </Button>
        </ResponsiveDialogFooter>
      ) : null}
    </ResponsiveDialogContent>
  );
}
