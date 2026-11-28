'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AssignSellerZoneInput,
  type ClientsWithoutCommunePage,
  type CreateZoneInput,
  type Role,
  type SellerZoneAssignmentDto,
  type SellerZoneAssignmentPage,
  OFFICE_ROLES,
  type UpdateZoneInput,
  type ZoneDto,
} from '@erp/shared';
import { api, ApiError } from './api-client';
import { useAuth } from './auth';
import { clientKeys } from './clients';
import { communeDisplay, type CommunesModule } from './locations';

/** Field zones, seller zone assignments and clients without a commune (phase 40b). */
export const zoneKeys = {
  all: ['field-zones'] as const,
  assignments: (userId: string) => ['zone-assignments', userId] as const,
};

/** Who reads zones, assigns sellers and fixes clients without commune: office and leads. */
export const leadsOrOffice = (role: Role | undefined): boolean =>
  !!role && OFFICE_ROLES.includes(role);

export function useZones(enabled = true) {
  return useQuery({
    queryKey: zoneKeys.all,
    queryFn: ({ signal }) => api.request<ZoneDto[]>('/field-zones', { signal }),
    enabled,
  });
}

export function useSaveZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: CreateZoneInput | UpdateZoneInput }) =>
      api.request<ZoneDto>(id ? `/field-zones/${id}` : '/field-zones', {
        method: id ? 'PUT' : 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: zoneKeys.all }),
  });
}

export function useDeleteZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/field-zones/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: zoneKeys.all }),
  });
}

export function useZoneAssignments(userId: string) {
  return useInfiniteQuery({
    queryKey: zoneKeys.assignments(userId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<SellerZoneAssignmentPage>(
        `/users/${userId}/zone-assignments?${params.toString()}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAssignZone(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignSellerZoneInput) =>
      api.request<SellerZoneAssignmentDto>(`/users/${userId}/zone-assignment`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: zoneKeys.assignments(userId) });
      // Under BY_ZONE the move changes which clients are visible.
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

/** Under `clientKeys.all`, so that saving a client refreshes the list and the count. */
export function useClientsWithoutCommune(limit = 50) {
  const role = useAuth().state.user?.role;
  return useInfiniteQuery({
    queryKey: [...clientKeys.all, 'without-commune', limit],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<ClientsWithoutCommunePage>(
        `/clients/without-commune?${params.toString()}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: leadsOrOffice(role),
  });
}

/** The communes a zone error names (`details.communeCodes`), in the screen's language. */
export function errorCommunes(
  err: unknown,
  data: CommunesModule | undefined,
  locale: string,
): string[] {
  if (!(err instanceof ApiError)) return [];
  const codes = (err.details as { communeCodes?: unknown } | undefined)?.communeCodes;
  if (!Array.isArray(codes)) return [];
  return codes
    .filter((c): c is number => typeof c === 'number')
    .map((c) => communeDisplay(data, c, null, locale) ?? String(c));
}
