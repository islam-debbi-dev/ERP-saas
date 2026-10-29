'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  AgingReportDto,
  ClientsToRemindDto,
  CreateShareLinkInput,
  ShareLinkDto,
  SupplierDto,
  SupplierLedgerPage,
  SupplierPaymentPage,
} from '@erp/shared';
import { api } from './api-client';

/** Crédit avancé (phase 21): supplier accounts, aging, reminders, share links. */
export const creditKeys = {
  supplier: (id: string) => ['suppliers', id] as const,
  ledger: (id: string) => ['suppliers', id, 'ledger'] as const,
  payments: (id: string) => ['suppliers', id, 'payments'] as const,
  aging: (kind: 'clients' | 'suppliers', asOf: string) => ['aging', kind, asOf] as const,
  toRemind: ['clients', 'to-remind'] as const,
};

export function useSupplier(id: string) {
  return useQuery({
    queryKey: creditKeys.supplier(id),
    queryFn: () => api.request<SupplierDto>(`/suppliers/${id}`),
  });
}

/** The supplier account, newest entry first, 50 at a time. */
export function useSupplierLedger(id: string) {
  return useInfiniteQuery({
    queryKey: creditKeys.ledger(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.request<SupplierLedgerPage>(
        `/suppliers/${id}/ledger?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSupplierPayments(supplierId: string) {
  return useQuery({
    queryKey: creditKeys.payments(supplierId),
    queryFn: () =>
      api.request<SupplierPaymentPage>(`/supplier-payments?supplierId=${supplierId}&limit=20`),
  });
}

export const agingPath = (kind: 'clients' | 'suppliers') =>
  kind === 'clients' ? '/reports/aging' : '/reports/supplier-aging';

export function useAging(kind: 'clients' | 'suppliers', asOf: string) {
  return useQuery({
    queryKey: creditKeys.aging(kind, asOf),
    queryFn: ({ signal }) =>
      api.request<AgingReportDto>(`${agingPath(kind)}?asOf=${asOf}`, { signal }),
    enabled: asOf !== '',
  });
}

export function useClientsToRemind() {
  return useQuery({
    queryKey: creditKeys.toRemind,
    queryFn: () => api.request<ClientsToRemindDto>('/clients/to-remind'),
  });
}

export function createShareLink(input: CreateShareLinkInput): Promise<ShareLinkDto> {
  return api.request<ShareLinkDto>('/share-links', { method: 'POST', body: input });
}

export function revokeShareLink(id: string): Promise<void> {
  return api.request<void>(`/share-links/${id}`, { method: 'DELETE' });
}

/** `https://wa.me/?text=…`: WhatsApp lets the user pick the contact. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
