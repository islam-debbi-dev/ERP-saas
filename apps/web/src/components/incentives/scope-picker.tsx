'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MetricScope } from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { flattenCategories, useCategories, useProductPages } from '@/lib/catalog';
import { useBrands } from '@/lib/sales-force';

/** Brand, category and product filters of a figure; empty = the whole figure. */
export function ScopePicker({
  id,
  value,
  onChange,
  requireOne = false,
}: {
  id: string;
  value: MetricScope | null;
  onChange: (s: MetricScope | null) => void;
  requireOne?: boolean;
}) {
  const t = useTranslations('incentives');
  const brands = useBrands();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const products = useProductPages(search, false);
  const productItems = products.data?.pages[0]?.items ?? [];
  const set = (patch: Partial<Record<keyof MetricScope, string>>) => {
    const next = { ...(value ?? {}), ...patch } as Record<string, string | undefined>;
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    onChange(Object.keys(next).length ? next : null);
  };
  const selectedProduct = value?.productId;

  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="mb-1 text-sm font-medium">
        {requireOne ? t('scopeRequired') : t('scope')}
      </legend>
      <div className="space-y-1">
        <Label htmlFor={`${id}-brand`}>{t('scopeBrand')}</Label>
        <NativeSelect
          id={`${id}-brand`}
          value={value?.brandId ?? ''}
          onChange={(e) => set({ brandId: e.target.value })}
        >
          <option value="">{t('scopeAll')}</option>
          {(brands.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-category`}>{t('scopeCategory')}</Label>
        <NativeSelect
          id={`${id}-category`}
          value={value?.categoryId ?? ''}
          onChange={(e) => set({ categoryId: e.target.value })}
        >
          <option value="">{t('scopeAll')}</option>
          {flattenCategories(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-product`}>{t('scopeProduct')}</Label>
        <Input
          id={`${id}-product-search`}
          type="search"
          aria-label={t('scopeProductSearch')}
          placeholder={t('scopeProductSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect
          id={`${id}-product`}
          value={selectedProduct ?? ''}
          onChange={(e) => set({ productId: e.target.value })}
        >
          <option value="">{t('scopeAll')}</option>
          {selectedProduct && !productItems.some((p) => p.id === selectedProduct) ? (
            <option value={selectedProduct}>{t('scopeProductChosen')}</option>
          ) : null}
          {productItems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.designation}
            </option>
          ))}
        </NativeSelect>
      </div>
    </fieldset>
  );
}
