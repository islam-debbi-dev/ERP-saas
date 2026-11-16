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
  /** The dashboard's figure filters (phase 33); '' = all. */
  sellerId?: string;
  teamOf?: string;
  brandId?: string;
  /** Statistics drill-down (phase 37): validated in these days, with the list's total. */
  validatedFrom?: string;
  validatedTo?: string;
  depotId?: string;
  segmentId?: string;
  /** A truck or a dépôt picked by the statistics; wins over the dépôt switcher. */
  warehouseId?: string;
}

export const saleKeys = {
  all: ['sales'] as const,
  list: (f: SaleFilters) => ['sales', 'list', f] as const,
  one: (id: string) => ['sales', id] as const,
};

export function useSalePages(filters: SaleFilters) {
  const switcher = useWarehouseFilter();
  const warehouseId = filters.warehouseId || switcher;
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
      if (filters.sellerId) params.set('sellerId', filters.sellerId);
      if (filters.teamOf) params.set('teamOf', filters.teamOf);
      if (filters.brandId) params.set('brandId', filters.brandId);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (filters.validatedFrom) params.set('validatedFrom', filters.validatedFrom);
      if (filters.validatedTo) params.set('validatedTo', filters.validatedTo);
      if (filters.depotId) params.set('depotId', filters.depotId);
      if (filters.segmentId) params.set('segmentId', filters.segmentId);
      // The statistics' own total of the list, on its first page.
      if (filters.validatedFrom && !pageParam) params.set('summary', 'true');
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
