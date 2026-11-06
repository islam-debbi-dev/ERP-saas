'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { defaultCashAccount, type PaymentMode, WarehouseType } from '@erp/shared';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useWarehouses } from '@/lib/stock';
import { useCashAccounts } from '@/lib/treasury';

/**
 * The account of a money form (phase 34), prefilled with the default the API would choose, by
 * the same rule. `value` is '' until the user picks one, and '' is what the form sends: the API
 * decides. Hidden when the company has one account per type, as there is nothing to choose.
 */
export function CashAccountPicker({
  id,
  mode,
  warehouseId,
  value,
  onChange,
}: {
  id: string;
  mode: PaymentMode;
  /** The row's dépôt, '' or null when it has none yet. */
  warehouseId?: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('treasury');
  const accounts = useCashAccounts(true);
  const warehouses = useWarehouses();
  // Another mode means another default: a pick made for the old one no longer holds.
  // Never on mount: a draft BR comes back with the account it was saved with.
  const pickedFor = useRef(mode);
  useEffect(() => {
    if (pickedFor.current === mode) return;
    pickedFor.current = mode;
    onChange('');
  }, [mode, onChange]);

  const list = accounts.data ?? [];
  const perType = new Map<string, number>();
  for (const a of list) perType.set(a.type, (perType.get(a.type) ?? 0) + 1);
  if (![...perType.values()].some((n) => n > 1)) return null;

  const depot = (warehouses.data ?? []).find((w) => w.id === warehouseId);
  const unit = depot?.type === WarehouseType.VEHICLE ? depot.parent?.id : depot?.id;
  const fallback = defaultCashAccount(
    list.map((a) => ({ ...a, warehouseId: a.warehouse?.id ?? null })),
    {
      mode,
      warehouseId: unit ?? null,
      mainWarehouseId: (warehouses.data ?? []).find((w) => w.isDefault)?.id ?? null,
    },
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('account')}</Label>
      <NativeSelect
        id={id}
        value={value || fallback?.id || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {fallback ? null : <option value="">{t('defaultAccount')}</option>}
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
