'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreatePayrollRunInput,
  type EmployeePayItemDto,
  type EmployeePayItemInput,
  Feature,
  type MyPayslipDto,
  type PatchPayrollRunInput,
  type PayItemTypeDto,
  type PayItemTypeInput,
  type PaymentMode,
  type PayrollRunDetailDto,
  type PayrollRunPage,
  type PayrollSettingsDto,
  type PayrollSettingsInput,
  Permission,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature, usePermission } from './auth';
import { expenseKeys } from './expenses';
import { hrKeys } from './hr';

/** Paie (phase 31b, module PAYROLL). */
export const payrollKeys = {
  all: ['payroll'] as const,
  runs: ['payroll', 'runs'] as const,
  run: (id: string) => ['payroll', 'run', id] as const,
  settings: ['payroll', 'settings'] as const,
  types: ['payroll', 'types'] as const,
  employeeItems: (id: string) => ['payroll', 'items', id] as const,
  employeeSlips: (id: string) => ['payroll', 'slips', id] as const,
  mine: ['payroll', 'mine'] as const,
};

export function usePayrollOn(): boolean {
  const on = useFeature(Feature.PAYROLL);
  const view = usePermission(Permission.SALARY_VIEW);
  return on && view;
}

function useRefreshPayroll() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: payrollKeys.all });
    void queryClient.invalidateQueries({ queryKey: hrKeys.all });
    void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
  };
}

export function usePayrollRuns() {
  return useInfiniteQuery({
    queryKey: payrollKeys.runs,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '24' });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<PayrollRunPage>(`/payroll-runs?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePayrollRun(id: string) {
  return useQuery({
    queryKey: payrollKeys.run(id),
    queryFn: ({ signal }) => api.request<PayrollRunDetailDto>(`/payroll-runs/${id}`, { signal }),
  });
}

export function useCreatePayrollRun() {
  const refresh = useRefreshPayroll();
  return useMutation({
    mutationFn: (body: CreatePayrollRunInput) =>
      api.request<PayrollRunDetailDto>('/payroll-runs', { method: 'POST', body }),
    onSuccess: refresh,
  });
}

/** Recompute, lines, approval and cancel: each answers the run as it now stands. */
export function usePayrollRunActions(id: string) {
  const refresh = useRefreshPayroll();
  const post = (path: string, body: object) =>
    api.request<PayrollRunDetailDto>(`/payroll-runs/${id}${path}`, { method: 'POST', body });
  return {
    recompute: useMutation({ mutationFn: () => post('/recompute', {}), onSuccess: refresh }),
    patch: useMutation({
      mutationFn: (body: PatchPayrollRunInput) =>
        api.request<PayrollRunDetailDto>(`/payroll-runs/${id}`, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: (version: number) => post('/approve', { version }),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (reason: string) => post('/cancel', { reason }),
      onSuccess: refresh,
    }),
    pay: useMutation({
      mutationFn: ({
        key,
        body,
      }: {
        key: string;
        body: {
          mode: PaymentMode;
          reference: string | null;
          items?: { employeeId: string; amount?: string }[];
        };
      }) =>
        api.request<PayrollRunDetailDto>(`/payroll-runs/${id}/payments`, {
          method: 'POST',
          idempotencyKey: key,
          body,
        }),
      onSuccess: refresh,
    }),
  };
}

export async function downloadPayrollFile(path: string, fileName: string): Promise<void> {
  const blob = await api.download(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function usePayrollSettings() {
  return useQuery({
    queryKey: payrollKeys.settings,
    queryFn: ({ signal }) => api.request<PayrollSettingsDto>('/payroll-settings', { signal }),
  });
}

export function useSavePayrollSettings() {
  const refresh = useRefreshPayroll();
  return useMutation({
    mutationFn: (body: PayrollSettingsInput) =>
      api.request<PayrollSettingsDto>('/payroll-settings', { method: 'PUT', body }),
    onSuccess: refresh,
  });
}

export function usePayItemTypes(enabled = true) {
  return useQuery({
    queryKey: payrollKeys.types,
    enabled,
    queryFn: ({ signal }) => api.request<PayItemTypeDto[]>('/pay-item-types', { signal }),
  });
}

export function useSavePayItemType() {
  const refresh = useRefreshPayroll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: PayItemTypeInput }) =>
      api.request<PayItemTypeDto>(id ? `/pay-item-types/${id}` : '/pay-item-types', {
        method: id ? 'PUT' : 'POST',
        body,
      }),
    onSuccess: refresh,
  });
}

export function useArchivePayItemType() {
  const refresh = useRefreshPayroll();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/pay-item-types/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}

export function useEmployeePayItems(id: string, enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.employeeItems(id),
    enabled,
    queryFn: ({ signal }) =>
      api.request<EmployeePayItemDto[]>(`/employees/${id}/pay-items`, { signal }),
  });
}

export function useAddEmployeePayItem(id: string) {
  const refresh = useRefreshPayroll();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: EmployeePayItemInput }) =>
      api.request<EmployeePayItemDto[]>(`/employees/${id}/pay-items`, {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useEmployeePayslips(id: string, enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.employeeSlips(id),
    enabled,
    queryFn: ({ signal }) => api.request<MyPayslipDto[]>(`/employees/${id}/payslips`, { signal }),
  });
}

export function useMyPayslips() {
  return useQuery({
    queryKey: payrollKeys.mine,
    queryFn: ({ signal }) => api.request<MyPayslipDto[]>('/me/payslips', { signal }),
  });
}

/** `2026-10` → `octobre 2026`, in the screen's language. */
export function monthName(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}
