'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Feature,
  type IncentivePlanDto,
  type IncentiveRunDetailDto,
  type IncentiveRunDto,
  type MyObjectivesDto,
  type SalesTargetDto,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature } from './auth';

/** Objectifs & primes (phase 18). */
export const incentiveKeys = {
  all: ['incentives'] as const,
  plans: ['incentives', 'plans'] as const,
  plan: (id: string) => ['incentives', 'plans', id] as const,
  runs: ['incentives', 'runs'] as const,
  run: (id: string) => ['incentives', 'runs', id] as const,
  targets: (period: string, metric: string) => ['incentives', 'targets', period, metric] as const,
  mine: ['incentives', 'mine'] as const,
};

export function usePlans() {
  const on = useFeature(Feature.INCENTIVES);
  return useQuery({
    queryKey: incentiveKeys.plans,
    queryFn: ({ signal }) => api.request<IncentivePlanDto[]>('/incentive-plans', { signal }),
    enabled: on,
  });
}

export function usePlan(id: string) {
  const on = useFeature(Feature.INCENTIVES);
  return useQuery({
    queryKey: incentiveKeys.plan(id),
    queryFn: ({ signal }) => api.request<IncentivePlanDto>(`/incentive-plans/${id}`, { signal }),
    enabled: on,
  });
}

export function useRuns() {
  const on = useFeature(Feature.INCENTIVES);
  return useQuery({
    queryKey: incentiveKeys.runs,
    queryFn: ({ signal }) => api.request<IncentiveRunDto[]>('/incentive-runs', { signal }),
    enabled: on,
  });
}

export function useRun(id: string) {
  const on = useFeature(Feature.INCENTIVES);
  return useQuery({
    queryKey: incentiveKeys.run(id),
    queryFn: ({ signal }) =>
      api.request<IncentiveRunDetailDto>(`/incentive-runs/${id}`, { signal }),
    enabled: on,
  });
}

export function useTargets(period: string, metric: string, enabled = true) {
  const on = useFeature(Feature.INCENTIVES);
  return useQuery({
    queryKey: incentiveKeys.targets(period, metric),
    queryFn: ({ signal }) =>
      api.request<SalesTargetDto[]>(`/sales-targets?period=${period}&metric=${metric}`, {
        signal,
      }),
    enabled: on && enabled && /^\d{4}-\d{2}$/.test(period),
  });
}

export function useMyObjectives() {
  const on = useFeature(Feature.INCENTIVES);
  return useQuery({
    queryKey: incentiveKeys.mine,
    queryFn: ({ signal }) => api.request<MyObjectivesDto>('/me/objectives', { signal }),
    enabled: on,
    staleTime: 60_000,
  });
}

/** Saves the approved run as .xlsx for payroll. */
export async function downloadRun(run: IncentiveRunDto): Promise<void> {
  const blob = await api.download(`/incentive-runs/${run.id}/export.xlsx`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `primes-${run.period}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `YYYY-MM` of the Algiers month, shifted by `delta` months. */
export function monthShift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' })
    .format(new Date())
    .slice(0, 7);
}
