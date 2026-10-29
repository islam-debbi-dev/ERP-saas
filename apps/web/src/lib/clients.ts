'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type ClientDto, type ClientPage, type ClientStatementDto, money, Role } from '@erp/shared';
import { api } from './api-client';
import { useAuth } from './auth';

export interface ClientFilters {
  search: string;
  hasDebt: boolean;
  overLimit: boolean;
  /** Sales force (phase 14): '' = any. */
  sectorId?: string;
  assignedSellerId?: string;
}

export const clientKeys = {
  all: ['clients'] as const,
  list: (f: ClientFilters) => ['clients', 'list', f] as const,
  one: (id: string) => ['clients', id] as const,
  statement: (id: string, from: string, to: string) =>
    ['clients', id, 'statement', { from, to }] as const,
};

export function useClientPages(filters: ClientFilters) {
  return useInfiniteQuery({
    queryKey: clientKeys.list(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (filters.search) params.set('search', filters.search);
      if (filters.hasDebt) params.set('hasDebt', 'true');
      if (filters.overLimit) params.set('overLimit', 'true');
      if (filters.sectorId) params.set('sectorId', filters.sectorId);
      if (filters.assignedSellerId) params.set('assignedSellerId', filters.assignedSellerId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<ClientPage>(`/clients?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Disabled when `id` is empty (new client). */
export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.one(id),
    queryFn: () => api.request<ClientDto>(`/clients/${id}`),
    enabled: id !== '',
  });
}

export function useStatement(id: string, from: string, to: string) {
  return useQuery({
    queryKey: clientKeys.statement(id, from, to),
    queryFn: ({ signal }) =>
      api.request<ClientStatementDto>(`/clients/${id}/statement?from=${from}&to=${to}`, {
        signal,
      }),
    enabled: from !== '' && to !== '' && from <= to,
  });
}

/** Mirrors the API: only owners and managers set plafonds, opening balances and adjustments. */
export function useCanManageCredit(): boolean {
  const { state } = useAuth();
  return state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
}

/** Share of the plafond used, 0–100 (display only). Null when the client has no plafond. */
export function plafondUsage(client: Pick<ClientDto, 'balance' | 'creditLimit'>): number | null {
  if (client.creditLimit === null) return null;
  const limit = money(client.creditLimit);
  if (limit.isZero()) return money(client.balance).gt(0) ? 100 : 0;
  const pct = money(client.balance).div(limit).times(100);
  return Math.min(100, Math.max(0, pct.round().toNumber()));
}
