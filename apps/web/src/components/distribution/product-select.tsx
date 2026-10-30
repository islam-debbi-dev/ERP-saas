'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ProductDto } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useProductPages } from '@/lib/catalog';

/** A product found by search, then picked in a list (keeps the picked one when the search changes). */
export function ProductSelect({
  id,
  label,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  label: string;
  value: ProductDto | null;
  onChange: (p: ProductDto | null) => void;
  /** Label of the empty choice; none = a product is required. */
  emptyLabel?: string;
}) {
  const t = useTranslations('promotions');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 250);
  const pages = useProductPages(debounced, false);
  const items = pages.data?.pages[0]?.items ?? [];
  const options = value && !items.some((p) => p.id === value.id) ? [value, ...items] : items;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={`${id}-search`}
        type="search"
        aria-label={t('productSearch', { field: label })}
        placeholder={t('productSearchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <NativeSelect
        id={id}
        value={value?.id ?? ''}
        onChange={(e) => onChange(options.find((p) => p.id === e.target.value) ?? null)}
      >
        <option value="">{emptyLabel ?? t('pickProduct')}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.designation} ({p.reference})
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
