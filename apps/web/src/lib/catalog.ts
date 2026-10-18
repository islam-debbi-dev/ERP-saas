'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  type BarcodeMatchDto,
  type CategoryDto,
  DEFAULT_UNITS,
  type DefaultUnitCode,
  type PriceLevelDto,
  type ProductDto,
  type ProductPage,
  type UnitDto,
} from '@erp/shared';
import { api, ApiError } from './api-client';

export const catalogKeys = {
  units: ['units'] as const,
  priceLevels: ['price-levels'] as const,
  categories: ['categories'] as const,
  products: (search: string, archived: boolean) => ['products', { search, archived }] as const,
  product: (id: string) => ['product', id] as const,
};

export function useUnits() {
  return useQuery({ queryKey: catalogKeys.units, queryFn: () => api.request<UnitDto[]>('/units') });
}

export function usePriceLevels() {
  return useQuery({
    queryKey: catalogKeys.priceLevels,
    queryFn: () => api.request<PriceLevelDto[]>('/price-levels'),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: () => api.request<CategoryDto[]>('/categories'),
  });
}

/** Disabled when `id` is empty (the "new product" page). */
export function useProduct(id: string) {
  return useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: () => api.request<ProductDto>(`/products/${id}`),
    enabled: id !== '',
  });
}

/** Cursor pages of 50, newest query first; `fetchNextPage` loads the next 50. */
export function useProductPages(search: string, archived: boolean) {
  return useInfiniteQuery({
    queryKey: catalogKeys.products(search, archived),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      if (archived) params.set('archived', 'true');
      if (pageParam) params.set('cursor', pageParam);
      return api.request<ProductPage>(`/products?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

const DEFAULT_CODES = new Set<string>(DEFAULT_UNITS.map((u) => u.code));

/** Default units are translated; custom units show the name the tenant gave them. */
export function useUnitLabel(): (
  unit: { code: string; name: string | null } | undefined,
) => string {
  const t = useTranslations('units');
  return (unit) => {
    if (!unit) return '';
    if (DEFAULT_CODES.has(unit.code)) return t(unit.code as DefaultUnitCode);
    return unit.name ?? unit.code;
  };
}

/** Flat list "Parent › Child" for selects. */
export function flattenCategories(tree: CategoryDto[]): { id: string; label: string }[] {
  return tree.flatMap((c) => [
    { id: c.id, label: c.name },
    ...c.children.map((child) => ({ id: child.id, label: `${c.name} › ${child.name}` })),
  ]);
}

/**
 * Scan or typed code: barcode first (gives the scanned unit), then an exact
 * reference match (base unit). Null when nothing matches.
 */
export async function findProductByCode(
  code: string,
): Promise<{ product: ProductDto; unitId: string } | null> {
  try {
    const match = await api.request<BarcodeMatchDto>(
      `/products/by-barcode/${encodeURIComponent(code)}`,
    );
    return { product: match.product, unitId: match.unit.unitId };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  const page = await api.request<ProductPage>(
    `/products?search=${encodeURIComponent(code)}&limit=5`,
  );
  const exact = page.items.find((p) => p.reference.toLowerCase() === code.toLowerCase());
  return exact ? { product: exact, unitId: exact.baseUnitId } : null;
}
