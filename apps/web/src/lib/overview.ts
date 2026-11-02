'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type DayRange, Feature, type OverviewDto, Permission, WarehouseType } from '@erp/shared';
import { api } from './api-client';
import { useAuth, useFeature, usePermission } from './auth';
import { useWarehouses } from './stock';

export const overviewKeys = {
  all: ['overview'] as const,
  period: (range: DayRange) => ['overview', range] as const,
};

function overviewQuery(range: DayRange): string {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

/** Every dépôt the user sees, over one period (phase 26). Disabled while the period is reversed. */
export function useOverview(range: DayRange, enabled = true) {
  return useQuery({
    queryKey: overviewKeys.period(range),
    queryFn: ({ signal }) =>
      api.request<OverviewDto>(`/reports/overview?${overviewQuery(range)}`, { signal }),
    enabled: enabled && range.from !== '' && range.to !== '' && range.from <= range.to,
    // Keep the cards while another period loads.
    placeholderData: keepPreviousData,
  });
}

/** Saves the "Comparer" table as .xlsx through a temporary link. */
export async function downloadOverview(range: DayRange): Promise<void> {
  const blob = await api.download(`/reports/overview/export.xlsx?${overviewQuery(range)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vue-ensemble-${range.from}-${range.to}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Whether the user gets the Vue d'ensemble: the module, the finance figures and more than
 * one dépôt in reach (the API lists only those). null while the dépôts load.
 */
export function useHasOverview(): boolean | null {
  const { state } = useAuth();
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const finance = usePermission(Permission.REPORTS_FINANCE);
  const warehouses = useWarehouses();
  if (state.status !== 'authenticated') return null;
  if (!multiUnit || !warehousesOn || !finance) return false;
  if (!warehouses.data) return warehouses.isError ? false : null;
  return warehouses.data.filter((w) => w.type !== WarehouseType.VEHICLE && w.active).length > 1;
}

/** Where a user lands after signing in: the Vue d'ensemble when he has it. */
export function useHomePath(): string | null {
  const has = useHasOverview();
  if (has === null) return null;
  return has ? '/vue-ensemble' : '/tableau-de-bord';
}
