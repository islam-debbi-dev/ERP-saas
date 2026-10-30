'use client';

import { useTranslations } from 'next-intl';
import { Feature, type WarehouseDto } from '@erp/shared';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useFeature } from '@/lib/auth';
import { useWarehouses } from '@/lib/stock';

/** "Camion 1 · Karim" for a truck with a driver, the plain name otherwise. */
export function warehouseLabel(w: Pick<WarehouseDto, 'name' | 'assignedUser'>): string {
  return w.assignedUser ? `${w.name} · ${w.assignedUser.fullName}` : w.name;
}

/**
 * Dépôt picker of a document (phase 15). Renders nothing without the WAREHOUSES module:
 * the API then uses the one implicit dépôt. `''` is the default choice, described by
 * `defaultLabel` (main dépôt, the seller's truck, the dépôt of the sale…).
 */
export function WarehouseSelect({
  id,
  value,
  onChange,
  defaultLabel,
  label,
  disabled,
  excludeId,
}: {
  id: string;
  value: string;
  onChange: (warehouseId: string) => void;
  /** Shown for `''`; without it the first dépôt is pre-selected by the caller. */
  defaultLabel?: string;
  label?: string;
  disabled?: boolean;
  /** The other side of a transfer. */
  excludeId?: string;
}) {
  const t = useTranslations('warehouses');
  const enabled = useFeature(Feature.WAREHOUSES);
  const warehouses = useWarehouses();
  if (!enabled) return null;
  const options = (warehouses.data ?? []).filter((w) => w.active && w.id !== excludeId);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label ?? t('field')}</Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled || warehouses.isPending}
        onChange={(e) => onChange(e.target.value)}
      >
        {defaultLabel !== undefined ? <option value="">{defaultLabel}</option> : null}
        {options.map((w) => (
          <option key={w.id} value={w.id}>
            {warehouseLabel(w)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
