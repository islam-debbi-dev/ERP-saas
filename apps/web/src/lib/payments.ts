'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  CashSummaryDto,
  PaymentDto,
  PaymentMode,
  PaymentPage,
  PaymentStatus,
  UnpaidDocumentDto,
} from '@erp/shared';
import { api } from './api-client';
import { useWarehouseFilter } from './warehouse-scope';

export interface PaymentFilters {
  clientId: string;
  mode: PaymentMode | '';
  status: PaymentStatus | '';
  from: string;
  to: string;
  sort: 'receivedAt' | 'dueDate';
}

export const paymentKeys = {
  all: ['payments'] as const,
  list: (f: PaymentFilters) => ['payments', 'list', f] as const,
  one: (id: string) => ['payments', id] as const,
  summary: (date: string) => ['payments', 'summary', date] as const,
  unpaid: (clientId: string) => ['payments', 'unpaid', clientId] as const,
};

export function usePaymentPages(filters: PaymentFilters) {
  const warehouseId = useWarehouseFilter();
  return useInfiniteQuery({
    queryKey: [...paymentKeys.list(filters), warehouseId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50', sort: filters.sort });
      if (filters.clientId) params.set('clientId', filters.clientId);
      if (filters.mode) params.set('mode', filters.mode);
      if (filters.status) params.set('status', filters.status);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<PaymentPage>(`/payments?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: paymentKeys.one(id),
    queryFn: () => api.request<PaymentDto>(`/payments/${id}`),
    enabled: id !== '',
  });
}

/** Disabled when `clientId` is empty. */
export function useUnpaidDocuments(clientId: string) {
  return useQuery({
    queryKey: paymentKeys.unpaid(clientId),
    queryFn: () => api.request<UnpaidDocumentDto[]>(`/clients/${clientId}/unpaid-documents`),
    enabled: clientId !== '',
  });
}

export function useCashSummary(date: string) {
  return useQuery({
    queryKey: paymentKeys.summary(date),
    queryFn: () => api.request<CashSummaryDto>(`/payments/summary?date=${date}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
}
