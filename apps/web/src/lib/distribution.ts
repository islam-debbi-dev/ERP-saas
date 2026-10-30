'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type ClientPackagingDto,
  Feature,
  type PackagingMovementInput,
  type PackagingMovementResultDto,
  type PackagingTypeDto,
  type PackagingTypeInput,
  type PricingPreviewDto,
  type PricingPreviewInput,
  type ProductPackagingDto,
  type ProductPackagingInput,
  type PromotionDto,
  type PromotionInputRaw,
  type PromotionStatus,
  type SellOutDto,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature } from './auth';
import { clientKeys } from './clients';

/** Distribution mode (phase 20): promotions, emballages, sell-out. */
export const distributionKeys = {
  promotions: (status: PromotionStatus) => ['promotions', status] as const,
  allPromotions: ['promotions'] as const,
  preview: (body: unknown) => ['pricing-preview', body] as const,
  packagingTypes: ['packaging-types'] as const,
  productPackaging: (productId: string) => ['products', productId, 'packaging'] as const,
  clientPackaging: (clientId: string) => ['clients', clientId, 'packaging'] as const,
  sellOut: (q: SellOutParams) => ['reports', 'sell-out', q] as const,
};

// ---------------------------------------------------------------- promotions

export function usePromotions(status: PromotionStatus) {
  return useQuery({
    queryKey: distributionKeys.promotions(status),
    queryFn: ({ signal }) =>
      api.request<PromotionDto[]>(`/promotions?status=${status}`, { signal }),
  });
}

export function useSavePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      version,
      body,
    }: {
      id: string | null;
      version: number;
      body: PromotionInputRaw;
    }) =>
      api.request<PromotionDto>(id ? `/promotions/${id}` : '/promotions', {
        method: id ? 'PUT' : 'POST',
        body: id ? { version, promotion: body } : body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: distributionKeys.allPromotions }),
  });
}

export function useArchivePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/promotions/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: distributionKeys.allPromotions }),
  });
}

/**
 * What the API would charge for these lines (promotions included). Only asked when the
 * company has promotions; the screen keeps the previous answer while a new one loads.
 */
export function usePricingPreview(body: PricingPreviewInput | null) {
  const enabled = useFeature(Feature.PROMOTIONS) && !!body && body.lines.length > 0;
  return useQuery({
    queryKey: distributionKeys.preview(body),
    queryFn: ({ signal }) =>
      api.request<PricingPreviewDto>('/pricing/preview', { method: 'POST', body, signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}

// ---------------------------------------------------------------- emballages

export function usePackagingTypes(enabled = true) {
  return useQuery({
    queryKey: distributionKeys.packagingTypes,
    queryFn: ({ signal }) => api.request<PackagingTypeDto[]>('/packaging-types', { signal }),
    enabled,
  });
}

export function useSavePackagingType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: PackagingTypeInput }) =>
      api.request<PackagingTypeDto>(id ? `/packaging-types/${id}` : '/packaging-types', {
        method: id ? 'PUT' : 'POST',
        body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: distributionKeys.packagingTypes }),
  });
}

export function useArchivePackagingType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/packaging-types/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: distributionKeys.packagingTypes }),
  });
}

export function useProductPackaging(productId: string | null) {
  return useQuery({
    queryKey: distributionKeys.productPackaging(productId ?? ''),
    queryFn: ({ signal }) =>
      api.request<ProductPackagingDto[]>(`/products/${productId}/packaging`, { signal }),
    enabled: !!productId,
  });
}

export function useSaveProductPackaging(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductPackagingInput) =>
      api.request<ProductPackagingDto[]>(`/products/${productId}/packaging`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(distributionKeys.productPackaging(productId), data);
      void queryClient.invalidateQueries({ queryKey: distributionKeys.packagingTypes });
    },
  });
}

/** The client's counts and his packaging entries (newest first, "load more"). */
export function useClientPackaging(clientId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: distributionKeys.clientPackaging(clientId ?? ''),
    queryFn: ({ pageParam, signal }) =>
      api.request<ClientPackagingDto>(
        `/clients/${clientId}/packaging?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!clientId && enabled,
  });
}

export function usePackagingMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: PackagingMovementInput; key: string }) =>
      api.request<PackagingMovementResultDto>('/packaging-movements', {
        method: 'POST',
        body,
        idempotencyKey: key,
      }),
    onSuccess: (_data, { body }) => {
      void queryClient.invalidateQueries({
        queryKey: distributionKeys.clientPackaging(body.clientId),
      });
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

// ---------------------------------------------------------------- sell-out

export interface SellOutParams {
  from: string;
  to: string;
  brandId: string;
  sectorId: string;
  sellerId: string;
  clientType: string;
}

function sellOutQuery(p: SellOutParams): string {
  const q = new URLSearchParams({ from: p.from, to: p.to });
  if (p.brandId) q.set('brandId', p.brandId);
  if (p.sectorId) q.set('sectorId', p.sectorId);
  if (p.sellerId) q.set('sellerId', p.sellerId);
  if (p.clientType) q.set('clientType', p.clientType);
  return q.toString();
}

export function useSellOut(p: SellOutParams) {
  return useQuery({
    queryKey: distributionKeys.sellOut(p),
    queryFn: ({ signal }) =>
      api.request<SellOutDto>(`/reports/sell-out?${sellOutQuery(p)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** Saves the sell-out as .xlsx through a temporary link. */
export async function downloadSellOut(p: SellOutParams): Promise<void> {
  const blob = await api.download(`/reports/sell-out/export.xlsx?${sellOutQuery(p)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sell-out-${p.from}-${p.to}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
