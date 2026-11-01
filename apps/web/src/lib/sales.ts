'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  PriceLevelDto,
  ProductDto,
  SaleDto,
  SalePage,
  SaleStatus,
  SaleType,
} from '@erp/shared';
import { api } from './api-client';
import { useWarehouseFilter } from './warehouse-scope';

export interface SaleFilters {
  type: SaleType | '';
  status: SaleStatus | '';
  clientId: string;
  from: string;
  to: string;
}

export const saleKeys = {
  all: ['sales'] as const,
  list: (f: SaleFilters) => ['sales', 'list', f] as const,
  one: (id: string) => ['sales', id] as const,
};

export function useSalePages(filters: SaleFilters) {
  const warehouseId = useWarehouseFilter();
  return useInfiniteQuery({
    queryKey: [...saleKeys.list(filters), warehouseId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (filters.type) params.set('type', filters.type);
      if (filters.status) params.set('status', filters.status);
      if (filters.clientId) params.set('clientId', filters.clientId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<SalePage>(`/sales?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Disabled when `id` is empty. */
export function useSale(id: string) {
  return useQuery({
    queryKey: saleKeys.one(id),
    queryFn: () => api.request<SaleDto>(`/sales/${id}`),
    enabled: id !== '',
  });
}

/** The client's level, otherwise the first level (gros), as the API resolves it. */
export function effectiveLevel(
  levels: PriceLevelDto[],
  clientLevelId: string | null | undefined,
): string | null {
  if (clientLevelId) return clientLevelId;
  return [...levels].sort((a, b) => a.position - b.position)[0]?.id ?? null;
}

/** List price HT of one product unit at a level (display only; the API decides). */
export function listPrice(
  product: ProductDto,
  unitId: string,
  levelId: string | null,
): string | null {
  if (!levelId) return null;
  return (
    product.prices.find((p) => p.unitId === unitId && p.priceLevelId === levelId)?.priceHt ?? null
  );
}
