'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChargesReportDto,
  type CloseRentContractInput,
  type CreateRentContractInput,
  type ExpenseCategoryDto,
  type ExpenseDto,
  type ExpensePage,
  Feature,
  type PaymentMode,
  Permission,
  type RentContractDto,
  type RentScheduleDto,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature, usePermission } from './auth';
import { useWarehouseFilter } from './warehouse-scope';

/** Dépenses, baux and charges (phase 25, module EXPENSES). */
export const expenseKeys = {
  all: ['expenses'] as const,
  list: (f: ExpenseFilters, warehouseId: string) => ['expenses', 'list', f, warehouseId] as const,
  categories: ['expenses', 'categories'] as const,
  contracts: (warehouseId: string) => ['expenses', 'contracts', warehouseId] as const,
  schedule: (id: string) => ['expenses', 'schedule', id] as const,
  charges: (q: ChargesParams) => ['expenses', 'charges', q] as const,
};

export interface ExpenseFilters {
  categoryId: string;
  mode: PaymentMode | '';
  status: 'VALID' | 'CANCELLED' | '';
  from: string;
  to: string;
}

export interface ChargesParams {
  from: string;
  to: string;
  warehouseId: string;
}

/** Can see the dépenses at all: the module and EXPENSES_VIEW. */
export function useExpensesOn(): boolean {
  const on = useFeature(Feature.EXPENSES);
  const view = usePermission(Permission.EXPENSES_VIEW);
  return on && view;
}

export function useExpensePages(filters: ExpenseFilters) {
  const warehouseId = useWarehouseFilter();
  return useInfiniteQuery({
    queryKey: expenseKeys.list(filters, warehouseId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (filters.categoryId) params.set('categoryId', filters.categoryId);
      if (filters.mode) params.set('mode', filters.mode);
      if (filters.status) params.set('status', filters.status);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<ExpensePage>(`/expenses?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useExpenseCategories(enabled = true) {
  return useQuery({
    queryKey: expenseKeys.categories,
    queryFn: ({ signal }) => api.request<ExpenseCategoryDto[]>('/expense-categories', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

/** Contracts of one dépôt ('' = every dépôt the user works in). */
export function useRentContracts(warehouseId: string, enabled = true) {
  return useQuery({
    queryKey: expenseKeys.contracts(warehouseId),
    queryFn: ({ signal }) =>
      api.request<RentContractDto[]>(
        `/rent-contracts${warehouseId ? `?warehouseId=${warehouseId}` : ''}`,
        { signal },
      ),
    enabled,
  });
}

export function useRentSchedule(id: string) {
  return useQuery({
    queryKey: expenseKeys.schedule(id),
    queryFn: ({ signal }) =>
      api.request<RentScheduleDto>(`/rent-contracts/${id}/schedule`, { signal }),
    enabled: id !== '',
  });
}

export function useCharges(q: ChargesParams, enabled: boolean) {
  return useQuery({
    queryKey: expenseKeys.charges(q),
    queryFn: ({ signal }) =>
      api.request<ChargesReportDto>(`/reports/charges?${chargesQuery(q)}`, { signal }),
    enabled: enabled && q.from <= q.to,
  });
}

function chargesQuery(q: ChargesParams): string {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.warehouseId) params.set('warehouseId', q.warehouseId);
  return params.toString();
}

/** Saves the charges report as .xlsx through a temporary link. */
export async function downloadCharges(q: ChargesParams): Promise<void> {
  const blob = await api.download(`/reports/charges/export.xlsx?${chargesQuery(q)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `charges-${q.from}-${q.to}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useCancelExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, key }: { id: string; reason: string; key: string }) =>
      api.request<ExpenseDto>(`/expenses/${id}/cancel`, {
        method: 'POST',
        idempotencyKey: key,
        body: { reason },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useSaveRentContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: CreateRentContractInput }) =>
      api.request<RentContractDto>(id ? `/rent-contracts/${id}` : '/rent-contracts', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useCloseRentContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CloseRentContractInput }) =>
      api.request<RentContractDto>(`/rent-contracts/${id}/close`, { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useSaveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string | null; name: string }) =>
      api.request<ExpenseCategoryDto>(id ? `/expense-categories/${id}` : '/expense-categories', {
        method: id ? 'PUT' : 'POST',
        body: { name },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useArchiveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<void>(`/expense-categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}
