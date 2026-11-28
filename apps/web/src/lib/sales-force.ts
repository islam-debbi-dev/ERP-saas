'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BrandDto,
  type ClientBulkAssignInput,
  type ClientBulkAssignResultDto,
  type CreateBrandInput,
  type CreateSectorInput,
  Feature,
  OFFICE_ROLES,
  type PaymentDto,
  type ReassignCollectorInput,
  type ReassignSellerInput,
  type Role,
  type SaleDto,
  type SectorDto,
  type TeamNodeDto,
} from '@erp/shared';
import { api } from './api-client';
import { useAuth, useFeature } from './auth';
import { clientKeys } from './clients';

/** Sales force (phase 14): brands (core), sectors, sellers, teams. */
export const salesForceKeys = {
  brands: ['brands'] as const,
  sectors: ['sectors'] as const,
  sellers: ['users', 'sellers'] as const,
  team: ['users', 'team'] as const,
};

export interface SellerOption {
  id: string;
  fullName: string;
  role: Role;
}

export function useBrands() {
  return useQuery({
    queryKey: salesForceKeys.brands,
    queryFn: ({ signal }) => api.request<BrandDto[]>('/brands', { signal }),
  });
}

/** Only fetched when the company has the module (the API refuses it otherwise). */
export function useSectors() {
  const enabled = useFeature(Feature.SALES_FORCE);
  return useQuery({
    queryKey: salesForceKeys.sectors,
    queryFn: ({ signal }) => api.request<SectorDto[]>('/sectors', { signal }),
    enabled,
  });
}

/** Office roles pick the seller of a sale; a seller always sells in his own name. */
export function useIsOffice(): boolean {
  const { state } = useAuth();
  return !!state.user && OFFICE_ROLES.includes(state.user.role);
}

/**
 * Active users who can be a seller; only office roles may list them. With `orderTakers`
 * (routes, commandes, visits, a client's seller) the pré-vendeurs are listed too; without
 * it, only who can sell or collect.
 */
export function useSellers({ orderTakers = false }: { orderTakers?: boolean } = {}) {
  const office = useIsOffice();
  return useQuery({
    queryKey: [...salesForceKeys.sellers, { orderTakers }],
    queryFn: ({ signal }) =>
      api.request<SellerOption[]>(`/users/sellers${orderTakers ? '?orderTakers=true' : ''}`, {
        signal,
      }),
    enabled: office,
    staleTime: 60_000,
  });
}

export function useTeam(enabled = true) {
  const on = useFeature(Feature.SALES_FORCE);
  return useQuery({
    queryKey: salesForceKeys.team,
    queryFn: ({ signal }) => api.request<TeamNodeDto[]>('/users/team', { signal }),
    enabled: enabled && on,
  });
}

export function useSaveBrand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: CreateBrandInput }) =>
      api.request<BrandDto>(id ? `/brands/${id}` : '/brands', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: salesForceKeys.brands }),
  });
}

export function useDeleteBrand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/brands/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: salesForceKeys.brands }),
  });
}

export function useSaveSector() {
  const queryClient = useQueryClient();
  return useMutation({
    // Location keys may be left out: the API then keeps what is stored.
    mutationFn: ({
      id,
      body,
    }: {
      id: string | null;
      body: Pick<CreateSectorInput, 'name'> & Partial<CreateSectorInput>;
    }) =>
      api.request<SectorDto>(id ? `/sectors/${id}` : '/sectors', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: salesForceKeys.sectors }),
  });
}

export function useDeleteSector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/sectors/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesForceKeys.sectors });
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export function useBulkAssign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ClientBulkAssignInput) =>
      api.request<ClientBulkAssignResultDto>('/clients/bulk-assign', { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      void queryClient.invalidateQueries({ queryKey: salesForceKeys.sectors });
    },
  });
}

export function useReassignSeller() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReassignSellerInput }) =>
      api.request<SaleDto>(`/sales/${id}/seller`, { method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sales'] }),
  });
}

export function useReassignCollector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReassignCollectorInput }) =>
      api.request<PaymentDto>(`/payments/${id}/collector`, { method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });
}
