'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface RemovableChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Chosen places, each removed with a tap. Long names wrap; nothing scrolls sideways. */
export function RemovableChips({ label, chips }: { label: string; chips: RemovableChip[] }) {
  const t = useTranslations('locations');
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {chips.map((chip) => (
        <li key={chip.key} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={t('remove', { name: chip.label })}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border bg-secondary px-3 py-1 text-start text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
          >
            <span dir="auto" className="min-w-0 break-words">
              {chip.label}
            </span>
            <X className="size-4 shrink-0" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
