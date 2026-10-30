'use client';

import { BadgePercent, Gift, PackageOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  Feature,
  Permission,
  type PricedLineDto,
  type PricingPreviewInput,
  type SaleLineInput,
} from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useFeature, usePermission } from '@/lib/auth';
import { useUnitLabel } from '@/lib/catalog';
import { useClientPackaging, usePackagingTypes, usePricingPreview } from '@/lib/distribution';
import { formatQty } from '@/lib/stock';

export interface LinePromotion {
  /** The paid line as the API prices it (its remise may come from a promotion). */
  paid: PricedLineDto | null;
  free: PricedLineDto[];
}

/**
 * The API's preview of the lines (phase 20): which promotion each line gets and its free
 * units. Display only: the API applies the promotions again when the sale is saved.
 * Answers for the lines typed 0.4 s ago; `fresh` is false while the lines changed since.
 */
export function useSalePromotions(clientId: string | null, lines: SaleLineInput[]) {
  const on = useFeature(Feature.PROMOTIONS);
  const body = useMemo<PricingPreviewInput | null>(
    () => (on && lines.length > 0 ? { clientId, lines } : null),
    [on, clientId, lines],
  );
  const key = JSON.stringify(body);
  const debouncedKey = useDebouncedValue(key, 400);
  const debounced = useMemo(
    () => (debouncedKey === 'null' ? null : (JSON.parse(debouncedKey) as PricingPreviewInput)),
    [debouncedKey],
  );
  const preview = usePricingPreview(debounced);
  const fresh = debouncedKey === key && !preview.isPlaceholderData && !preview.isFetching;
  const byIndex = useMemo(() => {
    const out = new Map<number, LinePromotion>();
    for (const l of preview.data?.lines ?? []) {
      const entry = out.get(l.inputIndex) ?? { paid: null, free: [] };
      if (l.isFree) entry.free.push(l);
      else entry.paid = l;
      out.set(l.inputIndex, entry);
    }
    return out;
  }, [preview.data]);
  return { on, byIndex, fresh, error: preview.error };
}

/** Under a sale line: the promotion it gets and its free units (UG). */
export function PromoNote({
  promo,
  freeQty,
  onFreeQty,
}: {
  promo: LinePromotion | undefined;
  /** What the user typed; null = what the promotion gives. */
  freeQty: string | null;
  onFreeQty: (v: string | null) => void;
}) {
  const t = useTranslations('promotions');
  const unitLabel = useUnitLabel();
  const canOverride = usePermission(Permission.PROMO_OVERRIDE);
  const promotion = promo?.paid?.promotion ?? promo?.free[0]?.promotion ?? null;
  if (!promotion) return null;
  const free = promo?.free ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="secondary" className="max-w-full gap-1">
        <BadgePercent aria-hidden />
        <span className="truncate">{promotion.name}</span>
      </Badge>
      {free.map((f) => (
        <span key={f.position} className="inline-flex items-center gap-1 text-primary">
          <Gift className="size-4" aria-hidden />
          <span>{t('freeUnits')}</span>
          {canOverride ? (
            <Input
              aria-label={t('freeQtyOf', { product: f.designation })}
              dir="ltr"
              inputMode="decimal"
              className="num h-9 w-20"
              value={freeQty ?? formatQty(f.qty)}
              onChange={(e) => onFreeQty(e.target.value === '' ? null : e.target.value)}
            />
          ) : (
            <span dir="ltr" className="num font-medium">
              +{formatQty(f.qty)}
            </span>
          )}
          <span>{unitLabel({ code: f.unitCode, name: f.unitName })}</span>
          {f.designation !== promo?.paid?.designation ? (
            <span className="truncate text-muted-foreground">{f.designation}</span>
          ) : null}
        </span>
      ))}
      {free.length === 0 && promo?.paid && promo.paid.discountPct !== '0' ? (
        <span dir="ltr" className="num text-primary">
          −{promo.paid.discountPct} %
        </span>
      ) : null}
    </div>
  );
}

/**
 * Empties the client hands back with this sale (phase 20, PACKAGING), with what he has
 * now. Counts are whole numbers; an empty field is 0.
 */
export function PackagingReturnedCard({
  clientId,
  value,
  onChange,
}: {
  clientId: string;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const t = useTranslations('packaging');
  const types = usePackagingTypes();
  const packaging = useClientPackaging(clientId);
  const balances = packaging.data?.pages[0]?.balances ?? [];
  const list = types.data ?? [];
  if (list.length === 0) return null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-base">
          <PackageOpen className="size-4" aria-hidden />
          {t('returnedTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {list.map((p) => {
          const held = balances.find((b) => b.packagingTypeId === p.id)?.balance ?? 0;
          const id = `returned-${p.id}`;
          return (
            <div key={p.id} className="grid grid-cols-[1fr_6rem] items-center gap-2">
              <div className="min-w-0">
                <Label htmlFor={id} className="truncate">
                  {p.name}
                </Label>
                <p className="text-xs text-muted-foreground">{t('held', { count: held })}</p>
              </div>
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                className="num"
                placeholder="0"
                value={value[p.id] ?? ''}
                onChange={(e) =>
                  onChange({ ...value, [p.id]: e.target.value.replace(/[^\d]/g, '') })
                }
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** The returned counts as the API expects them (0 and empty left out). */
export function packagingReturnedInput(
  value: Record<string, string>,
): { packagingTypeId: string; qty: number }[] {
  return Object.entries(value)
    .map(([packagingTypeId, v]) => ({ packagingTypeId, qty: Number(v || '0') }))
    .filter((p) => Number.isInteger(p.qty) && p.qty > 0);
}
