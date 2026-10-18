'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type InventoryDto,
  type InventorySummaryDto,
  qty,
  splitPackaging,
  type StockLevelDto,
  type StockMovementPage,
  type StockPage,
  THOUSANDS_SEPARATOR,
} from '@erp/shared';
import { api } from './api-client';
import { useUnitLabel } from './catalog';

export const stockKeys = {
  all: ['stock'] as const,
  list: (search: string, low: boolean) => ['stock', 'list', { search, low }] as const,
  level: (productId: string) => ['stock', 'level', productId] as const,
  movements: (productId: string) => ['stock', 'movements', productId] as const,
  inventories: ['inventories'] as const,
  inventory: (id: string) => ['inventories', id] as const,
};

export function useStockPages(search: string, lowStock: boolean) {
  return useInfiniteQuery({
    queryKey: stockKeys.list(search, lowStock),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      if (lowStock) params.set('lowStock', 'true');
      if (pageParam) params.set('cursor', pageParam);
      return api.request<StockPage>(`/stock?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Disabled when `productId` is empty. */
export function useStockLevel(productId: string) {
  return useQuery({
    queryKey: stockKeys.level(productId),
    queryFn: () => api.request<StockLevelDto>(`/stock/${productId}`),
    enabled: productId !== '',
  });
}

export function useMovementPages(productId: string) {
  return useInfiniteQuery({
    queryKey: stockKeys.movements(productId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<StockMovementPage>(`/stock/${productId}/movements?${params.toString()}`, {
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useInventories() {
  return useQuery({
    queryKey: stockKeys.inventories,
    queryFn: () => api.request<InventorySummaryDto[]>('/inventories'),
  });
}

export function useInventory(id: string) {
  return useQuery({
    queryKey: stockKeys.inventory(id),
    queryFn: () => api.request<InventoryDto>(`/inventories/${id}`),
  });
}

/** "1 234,5": no useless trailing zeros, comma decimals, narrow-space grouping. */
export function formatQty(value: string, options: { signed?: boolean } = {}): string {
  const q = qty(value);
  const [int = '0', dec] = q.abs().toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
  const sign = q.isNegative() ? '-' : options.signed && q.gt(0) ? '+' : '';
  return `${sign}${grouped}${dec ? `,${dec}` : ''}`;
}

/** "12 Carton + 5 Pièce" from a base quantity and the largest packaging unit. */
export function usePackagingLabel(): (
  level: Pick<StockLevelDto, 'qtyBase' | 'packaging' | 'baseUnit'>,
) => string {
  const unitLabel = useUnitLabel();
  return (level) => {
    const base = unitLabel({ code: level.baseUnit.unitCode, name: level.baseUnit.unitName });
    if (!level.packaging) return `${formatQty(level.qtyBase)} ${base}`;
    const { packs, rest } = splitPackaging(level.qtyBase, level.packaging.factorToBase);
    const pack = unitLabel({ code: level.packaging.unitCode, name: level.packaging.unitName });
    if (packs.isZero()) return `${formatQty(rest.toString())} ${base}`;
    if (rest.isZero()) return `${formatQty(packs.toString())} ${pack}`;
    return `${formatQty(packs.toString())} ${pack} + ${formatQty(rest.abs().toString())} ${base}`;
  };
}
