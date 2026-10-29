'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashboardDto, ReportDto, ReportGroupBy, ReportName } from '@erp/shared';
import { api } from './api-client';

export interface ReportParams {
  name: ReportName;
  groupBy: ReportGroupBy;
  from: string;
  to: string;
  /** Sales force filters (phase 14); '' or absent = all. */
  sellerId?: string;
  teamOf?: string;
  brandId?: string;
}

export interface FigureFilters {
  sellerId: string;
  teamOf: string;
  brandId: string;
}

export const NO_FIGURE_FILTERS: FigureFilters = { sellerId: '', teamOf: '', brandId: '' };

export const reportKeys = {
  dashboard: (f: FigureFilters) => ['dashboard', f] as const,
  report: (p: ReportParams) => ['reports', p] as const,
};

function filterParams(params: URLSearchParams, f: Partial<FigureFilters>): URLSearchParams {
  if (f.sellerId) params.set('sellerId', f.sellerId);
  if (f.teamOf) params.set('teamOf', f.teamOf);
  if (f.brandId) params.set('brandId', f.brandId);
  return params;
}

function reportQuery(p: ReportParams): string {
  return filterParams(
    new URLSearchParams({ from: p.from, to: p.to, groupBy: p.groupBy }),
    p,
  ).toString();
}

/** What the user's role sees today (sections the role does not see are null). */
export function useDashboard(filters: FigureFilters = NO_FIGURE_FILTERS) {
  return useQuery({
    queryKey: reportKeys.dashboard(filters),
    queryFn: ({ signal }) => {
      const qs = filterParams(new URLSearchParams(), filters).toString();
      return api.request<DashboardDto>(`/dashboard${qs ? `?${qs}` : ''}`, { signal });
    },
    // Keep the figures while another filter loads.
    placeholderData: keepPreviousData,
  });
}

/** Disabled while the period is incomplete or reversed. */
export function useReport(p: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report(p),
    queryFn: ({ signal }) =>
      api.request<ReportDto>(`/reports/${p.name}?${reportQuery(p)}`, { signal }),
    enabled: p.from !== '' && p.to !== '' && p.from <= p.to,
    // Keep the table while another grouping or period loads.
    placeholderData: keepPreviousData,
  });
}

/** Saves the report as .xlsx through a temporary link. */
export async function downloadReport(p: ReportParams): Promise<void> {
  const blob = await api.download(`/reports/${p.name}/export.xlsx?${reportQuery(p)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${p.name}-${p.groupBy}-${p.from}-${p.to}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
