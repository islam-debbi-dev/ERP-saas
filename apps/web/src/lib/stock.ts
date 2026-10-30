'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateStockTransferInput,
  type CreateWarehouseInput,
  Feature,
  type InventoryDto,
  type InventorySummaryDto,
  qty,
  splitPackaging,
  type StockLevelDto,
  type StockMovementPage,
  type StockPage,
  type StockTransferDto,
  type StockTransferPage,
  THOUSANDS_SEPARATOR,
  type UpdateWarehouseInput,
  type WarehouseDto,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature } from './auth';
import { useUnitLabel } from './catalog';

export const stockKeys = {
  all: ['stock'] as const,
  list: (search: string, low: boolean, out: boolean, warehouseId: string) =>
    ['stock', 'list', { search, low, out, warehouseId }] as const,
  level: (productId: string) => ['stock', 'level', productId] as const,
  movements: (productId: string, warehouseId = '') =>
    ['stock', 'movements', productId, warehouseId] as const,
  inventories: ['inventories'] as const,
  inventory: (id: string) => ['inventories', id] as const,
  warehouses: ['warehouses'] as const,
  transfers: ['stock-transfers'] as const,
  transfer: (id: string) => ['stock-transfers', id] as const,
};

/** `warehouseId` = '' for the whole company. */
export function useStockPages(
  search: string,
  lowStock: boolean,
  outOfStock = false,
  warehouseId = '',
) {
  return useInfiniteQuery({
    queryKey: stockKeys.list(search, lowStock, outOfStock, warehouseId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      if (lowStock) params.set('lowStock', 'true');
      if (outOfStock) params.set('outOfStock', 'true');
      if (warehouseId) params.set('warehouseId', warehouseId);
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

export function useMovementPages(productId: string, warehouseId = '') {
  return useInfiniteQuery({
    queryKey: stockKeys.movements(productId, warehouseId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (warehouseId) params.set('warehouseId', warehouseId);
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

/** Dépôts and trucks (phase 15). Fetched only with the WAREHOUSES module. */
export function useWarehouses() {
  const enabled = useFeature(Feature.WAREHOUSES);
  return useQuery({
    queryKey: stockKeys.warehouses,
    queryFn: ({ signal }) => api.request<WarehouseDto[]>('/warehouses', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveWarehouse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string | null;
      body: CreateWarehouseInput | UpdateWarehouseInput;
    }) =>
      api.request<WarehouseDto>(id ? `/warehouses/${id}` : '/warehouses', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: stockKeys.warehouses }),
  });
}

export function useArchiveWarehouse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/warehouses/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: stockKeys.warehouses }),
  });
}

export function useTransferPages() {
  return useInfiniteQuery({
    queryKey: stockKeys.transfers,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<StockTransferPage>(`/stock-transfers?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTransfer(id: string) {
  return useQuery({
    queryKey: stockKeys.transfer(id),
    queryFn: ({ signal }) => api.request<StockTransferDto>(`/stock-transfers/${id}`, { signal }),
  });
}

/** Replaces the whole draft (header and lines). */
export function saveTransfer(id: string, body: CreateStockTransferInput) {
  return api.request<StockTransferDto>(`/stock-transfers/${id}`, { method: 'PUT', body });
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
