'use client';

import { Check, ChevronDown, Warehouse } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWarehouseScope } from '@/lib/warehouse-scope';

/**
 * Header dépôt switcher (phase 24, MULTI_UNIT): "Tous les dépôts" or one dépôt, filtering
 * every list, report and the dashboard. Hidden for a user with a single dépôt.
 */
export function WarehouseSwitcher() {
  const t = useTranslations('multiUnit');
  const { warehouseId, setWarehouseId, options, show } = useWarehouseScope();
  if (!show) return null;
  const current = options.find((w) => w.id === warehouseId);
  const choices = [{ id: '', name: t('allWarehouses') }, ...options];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-11 max-w-36 gap-1.5 px-2.5 md:h-8 md:max-w-56"
          aria-label={t('switcherAria', { name: current?.name ?? t('allWarehouses') })}
        >
          <Warehouse className="shrink-0" aria-hidden />
          <span className="truncate">{current?.name ?? t('allWarehouses')}</span>
          <ChevronDown className="shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t('switcherLabel')}</DropdownMenuLabel>
        {choices.map((w) => (
          <DropdownMenuItem
            key={w.id || 'all'}
            className="min-h-11 justify-between gap-3"
            onSelect={() => setWarehouseId(w.id)}
          >
            <span className="truncate">{w.name}</span>
            {w.id === warehouseId ? <Check aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
