'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CashAccountDto,
  type CashCountDto,
  type CashMovementPage,
  type CashTransferDto,
  Feature,
  Permission,
  type TreasurySummaryDto,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature, usePermission } from './auth';

/** Caisses, bank accounts and balances (phase 34, module TREASURY). */
export const treasuryKeys = {
  all: ['treasury'] as const,
  accounts: (pick: boolean) => ['treasury', 'accounts', pick] as const,
  summary: ['treasury', 'summary'] as const,
  movements: (id: string) => ['treasury', 'movements', id] as const,
};

/** Sees the balances: the module and TREASURY_VIEW. */
export function useTreasuryOn(): boolean {
  const on = useFeature(Feature.TREASURY);
  const view = usePermission(Permission.TREASURY_VIEW);
  return on && view;
}

/** With `pick`, the accounts this user may put money in, for a form. */
export function useCashAccounts(pick: boolean, enabled = true) {
  const on = useFeature(Feature.TREASURY);
  return useQuery({
    queryKey: treasuryKeys.accounts(pick),
    queryFn: ({ signal }) =>
      api.request<CashAccountDto[]>(`/cash-accounts${pick ? '?pick=true' : ''}`, { signal }),
    enabled: on && enabled,
    staleTime: 60_000,
  });
}

export function useTreasurySummary() {
  return useQuery({
    queryKey: treasuryKeys.summary,
    queryFn: ({ signal }) => api.request<TreasurySummaryDto>('/treasury/summary', { signal }),
  });
}

export function useCashMovements(accountId: string | null) {
  return useInfiniteQuery({
    queryKey: treasuryKeys.movements(accountId ?? ''),
    enabled: accountId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<CashMovementPage>(`/cash-accounts/${accountId}/movements?${params}`, {
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: treasuryKeys.all });
}

export function useTransfer() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: object }) =>
      api.request<CashTransferDto>('/treasury/transfers', {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useCancelTransfer() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, key, reason }: { id: string; key: string; reason: string }) =>
      api.request<CashTransferDto>(`/treasury/transfers/${id}/cancel`, {
        method: 'POST',
        idempotencyKey: key,
        body: { reason },
      }),
    onSuccess: refresh,
  });
}

export function useCashCount(accountId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: object }) =>
      api.request<CashCountDto>(`/cash-accounts/${accountId}/counts`, {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useCashOpening(accountId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: object }) =>
      api.request<CashAccountDto>(`/cash-accounts/${accountId}/opening`, {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useSaveCashAccount(id: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: object) =>
      api.request<CashAccountDto>(id ? `/cash-accounts/${id}` : '/cash-accounts', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: refresh,
  });
}

export function useArchiveCashAccount() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/cash-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}
