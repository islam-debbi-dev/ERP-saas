'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface FilterChip {
  key: string;
  /** What the filter keeps, e.g. "Mode : Espèces". */
  label: string;
  onRemove: () => void;
}

/**
 * The filters a list was opened with (from the URL, phase 33), each one removable in a tap.
 * Nothing is drawn when there is none.
 */
export function FilterChips({ chips, onClear }: { chips: FilterChip[]; onClear?: () => void }) {
  const t = useTranslations('dashboard');
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label={t('chipsLabel')}>
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={c.onRemove}
            aria-label={t('chipRemove', { label: c.label })}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border bg-secondary px-3 text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
          >
            <span dir="auto" className="truncate">
              {c.label}
            </span>
            <X className="size-4 shrink-0" aria-hidden />
          </button>
        </li>
      ))}
      {chips.length > 1 && onClear ? (
        <li>
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 px-2 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('chipsClear')}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
