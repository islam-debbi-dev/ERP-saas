'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PurchaseDto, PurchasePage, PurchaseStatus, SupplierPage } from '@erp/shared';
import { api } from './api-client';
import { useWarehouseFilter } from './warehouse-scope';

export interface PurchaseFilters {
  status: PurchaseStatus | '';
  supplierId: string;
  from: string;
  to: string;
}

export const purchaseKeys = {
  all: ['purchases'] as const,
  list: (f: PurchaseFilters) => ['purchases', 'list', f] as const,
  one: (id: string) => ['purchases', id] as const,
  suppliers: (search: string) => ['suppliers', search] as const,
};

/** Live suppliers (first 100, enough for the select; the list page searches). */
export function useSuppliers(search = '', enabled = true) {
  return useQuery({
    queryKey: purchaseKeys.suppliers(search),
    queryFn: () =>
      api.request<SupplierPage>(
        `/suppliers?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    enabled,
  });
}

export function usePurchasePages(filters: PurchaseFilters) {
  const warehouseId = useWarehouseFilter();
  return useInfiniteQuery({
    queryKey: [...purchaseKeys.list(filters), warehouseId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (filters.status) params.set('status', filters.status);
      if (filters.supplierId) params.set('supplierId', filters.supplierId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<PurchasePage>(`/purchases?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Disabled when `id` is empty (new BR). */
export function usePurchase(id: string) {
  return useQuery({
    queryKey: purchaseKeys.one(id),
    queryFn: () => api.request<PurchaseDto>(`/purchases/${id}`),
    enabled: id !== '',
  });
}

/** Today in Algiers as YYYY-MM-DD (default document date). */
export function todayInAlgiers(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
}
