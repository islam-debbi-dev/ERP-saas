'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AttendanceDayDto,
  type AttendanceDayRowDto,
  type AttendanceMarkInput,
  type AttendanceMonthDto,
  type AttendanceTodayDto,
  type CorrectableStatus,
  type CreateEmployeeInput,
  type CreateLeaveRequestInput,
  type EmployeeDto,
  type EmployeeLedgerEntryDto,
  type EmployeeLedgerPage,
  type EmployeePage,
  type EmployeeSalaryDto,
  type EmployeeSalaryInput,
  Feature,
  type GeoInput,
  type HrSettingsDto,
  type HrSettingsInput,
  type LeaveBalanceDto,
  type LeaveRequestDto,
  type LeaveRequestPage,
  type LeaveRequestStatus,
  type MarkAttendanceResult,
  type MyAttendanceDto,
  type PaymentMode,
  Permission,
  type PublicHolidayDto,
  type PublicHolidayInput,
  type PublicHolidayListDto,
  type UpdateEmployeeInput,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature, usePermission } from './auth';
import { expenseKeys } from './expenses';
import { useWarehouseFilter } from './warehouse-scope';

/** DRH (phase 31, module HR). */
export const hrKeys = {
  all: ['hr'] as const,
  employees: (search: string, archived: boolean, warehouseId: string) =>
    ['hr', 'employees', search, archived, warehouseId] as const,
  employee: (id: string) => ['hr', 'employee', id] as const,
  salaries: (id: string) => ['hr', 'salaries', id] as const,
  ledger: (id: string) => ['hr', 'ledger', id] as const,
  leaveBalance: (id: string) => ['hr', 'leave-balance', id] as const,
  day: (date: string, warehouseId: string) => ['hr', 'day', date, warehouseId] as const,
  today: ['hr', 'today'] as const,
  month: (month: string, warehouseId: string) => ['hr', 'month', month, warehouseId] as const,
  me: ['hr', 'me'] as const,
  leaves: (status: string, warehouseId: string) => ['hr', 'leaves', status, warehouseId] as const,
  settings: ['hr', 'settings'] as const,
  holidays: (year: number) => ['hr', 'holidays', year] as const,
};

/** Every DRH screen reads more than one of these: refresh them together. */
export function useRefreshHr() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: hrKeys.all });
}

export function useHrOn(): boolean {
  const on = useFeature(Feature.HR);
  const view = usePermission(Permission.HR_VIEW);
  return on && view;
}

export function useEmployeePages(search: string, archived = false) {
  const warehouseId = useWarehouseFilter();
  return useInfiniteQuery({
    queryKey: hrKeys.employees(search, archived, warehouseId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      if (archived) params.set('archived', 'true');
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<EmployeePage>(`/employees?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: hrKeys.employee(id),
    queryFn: ({ signal }) => api.request<EmployeeDto>(`/employees/${id}`, { signal }),
  });
}

export function useSaveEmployee() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string | null;
      body: CreateEmployeeInput | UpdateEmployeeInput;
    }) =>
      api.request<EmployeeDto>(id ? `/employees/${id}` : '/employees', {
        method: id ? 'PUT' : 'POST',
        body,
      }),
    onSuccess: refresh,
  });
}

export function useArchiveEmployee() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/employees/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}

export function useSalaries(id: string, enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.salaries(id),
    enabled,
    queryFn: ({ signal }) =>
      api.request<EmployeeSalaryDto[]>(`/employees/${id}/salaries`, { signal }),
  });
}

export function useAddSalary(id: string) {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({ body, key }: { body: EmployeeSalaryInput; key: string }) =>
      api.request<EmployeeSalaryDto[]>(`/employees/${id}/salaries`, {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useEmployeeLedger(id: string, enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.ledger(id),
    enabled,
    queryFn: ({ signal }) =>
      api.request<EmployeeLedgerPage>(`/employees/${id}/ledger?limit=100`, { signal }),
  });
}

export function useLeaveBalance(id: string) {
  return useQuery({
    queryKey: hrKeys.leaveBalance(id),
    queryFn: ({ signal }) =>
      api.request<LeaveBalanceDto>(`/employees/${id}/leave-balance`, { signal }),
  });
}

export interface AdvanceBody {
  amount: string;
  mode: PaymentMode;
  note: string | null;
  reference: string | null;
}

export function usePayAdvance(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({ body, key }: { body: AdvanceBody; key: string }) =>
      api.request<EmployeeLedgerEntryDto>(`/employees/${id}/advances`, {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
    },
  });
}

export function useAttendanceDay(date: string) {
  const warehouseId = useWarehouseFilter();
  return useQuery({
    queryKey: hrKeys.day(date, warehouseId),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ date });
      if (warehouseId) params.set('warehouseId', warehouseId);
      return api.request<AttendanceDayDto>(`/attendance/day?${params.toString()}`, { signal });
    },
  });
}

export function useMarkAttendance() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: (input: { date: string; marks: AttendanceMarkInput[]; skipMarked?: boolean }) =>
      api.request<MarkAttendanceResult>('/attendance/events', {
        method: 'POST',
        // One key per tap: a double tap is stopped by the disabled row and by the API.
        idempotencyKey: crypto.randomUUID(),
        body: input,
      }),
    onSuccess: refresh,
  });
}

export function useCorrectAttendance() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({
      key,
      ...body
    }: {
      key: string;
      employeeId: string;
      date: string;
      correctedTo: CorrectableStatus;
      reason: string;
    }) =>
      api.request<AttendanceDayRowDto>('/attendance/corrections', {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useAttendanceToday(enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.today,
    enabled,
    queryFn: ({ signal }) => api.request<AttendanceTodayDto>('/attendance/today', { signal }),
  });
}

export function useAttendanceMonth(month: string) {
  const warehouseId = useWarehouseFilter();
  return useQuery({
    queryKey: hrKeys.month(month, warehouseId),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ month });
      if (warehouseId) params.set('warehouseId', warehouseId);
      return api.request<AttendanceMonthDto>(`/attendance/month?${params.toString()}`, { signal });
    },
  });
}

export async function downloadMonth(month: string, warehouseId: string): Promise<void> {
  const params = new URLSearchParams({ month });
  if (warehouseId) params.set('warehouseId', warehouseId);
  const blob = await api.download(`/attendance/month/export.xlsx?${params.toString()}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pointage-${month}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function useMyAttendance() {
  return useQuery({
    queryKey: hrKeys.me,
    queryFn: ({ signal }) => api.request<MyAttendanceDto>('/attendance/me', { signal }),
  });
}

export function useSelfAttendance() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({ kind, geo }: { kind: 'check-in' | 'check-out'; geo: GeoInput | undefined }) =>
      api.request<MyAttendanceDto>(`/attendance/${kind}`, {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
        body: geo ? { geo } : {},
      }),
    onSuccess: refresh,
  });
}

export function useLeavePages(status: LeaveRequestStatus | '') {
  const warehouseId = useWarehouseFilter();
  return useInfiniteQuery({
    queryKey: hrKeys.leaves(status, warehouseId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (status) params.set('status', status);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<LeaveRequestPage>(`/leave-requests?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useRequestLeave() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateLeaveRequestInput; key: string }) =>
      api.request<LeaveRequestDto>('/leave-requests', {
        method: 'POST',
        idempotencyKey: key,
        body,
      }),
    onSuccess: refresh,
  });
}

export function useDecideLeave() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'approve' | 'reject' | 'cancel';
      reason?: string;
    }) =>
      api.request<LeaveRequestDto>(`/leave-requests/${id}/${action}`, {
        method: 'POST',
        ...(action === 'reject' ? {} : { idempotencyKey: crypto.randomUUID() }),
        body: reason ? { reason } : {},
      }),
    onSuccess: refresh,
  });
}

export function useHrSettings() {
  return useQuery({
    queryKey: hrKeys.settings,
    queryFn: ({ signal }) => api.request<HrSettingsDto>('/hr-settings', { signal }),
  });
}

export function useSaveHrSettings() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: (body: HrSettingsInput) =>
      api.request<HrSettingsDto>('/hr-settings', { method: 'PUT', body }),
    onSuccess: refresh,
  });
}

export function useHolidays(year: number) {
  return useQuery({
    queryKey: hrKeys.holidays(year),
    queryFn: ({ signal }) =>
      api.request<PublicHolidayListDto>(`/public-holidays?year=${year}`, { signal }),
  });
}

export function useSaveHoliday() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: (body: PublicHolidayInput) =>
      api.request<PublicHolidayDto>('/public-holidays', { method: 'POST', body }),
    onSuccess: refresh,
  });
}

export function useDeleteHoliday() {
  const refresh = useRefreshHr();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/public-holidays/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}
