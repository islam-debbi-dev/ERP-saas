'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  addDays,
  type ClientSegmentDto,
  type DayRange,
  Feature,
  monthRange,
  monthStart,
  monthToDate,
  Permission,
  Role,
  STAT_COMPARES,
  STAT_FILTER_KEYS,
  STAT_GROUP_BYS,
  type StatCell,
  type StatCompare,
  type StatFilterKey,
  type StatGroupBy,
  type StatMeasure,
  StatUnit,
  THOUSANDS_SEPARATOR,
  formatDA,
  type PutVehicleTargetsInput,
  type VehicleTargetsDto,
} from '@erp/shared';
import { api } from './api-client';
import { useAuth, useFeature, usePermission } from './auth';
import { todayInAlgiers } from './purchases';
import { type UrlFilterSpec, useUrlFilters } from './url-filters';

// ---------------------------------------------------------------- views and filters

export const STAT_VIEWS = [
  'global',
  'vehicles',
  'zones',
  'products',
  'clients',
  'visits',
  'orders',
  'dispersion',
  'targets',
  'day',
] as const;
export type StatView = (typeof STAT_VIEWS)[number];

export const STAT_PERIODS = ['today', 'yesterday', 'week', 'month', 'lastMonth', 'custom'] as const;
export type StatPeriod = (typeof STAT_PERIODS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const csv = z.string().max(4000);

/** Everything the screen keeps in the URL, so a view can be shared or bookmarked. */
export const STATS_URL_FILTERS = {
  view: z.enum(STAT_VIEWS),
  period: z.enum(STAT_PERIODS),
  from: day,
  to: day,
  compare: z.enum(STAT_COMPARES),
  groupBy: z.enum(STAT_GROUP_BYS),
  // Journée véhicule.
  vehicleId: z.uuid(),
  date: day,
  ...(Object.fromEntries(STAT_FILTER_KEYS.map((k) => [k, csv])) as Record<
    StatFilterKey,
    typeof csv
  >),
} satisfies UrlFilterSpec;

export type StatsUrl = { [K in keyof typeof STATS_URL_FILTERS]: string };

/** The days of a preset, from today in Algiers. */
export function periodRange(period: StatPeriod, today: string): DayRange {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'lastMonth':
      return monthRange(addDays(monthStart(today), -1));
    default:
      return monthToDate(today);
  }
}

export interface StatsState {
  view: StatView;
  period: StatPeriod;
  range: DayRange;
  compare: StatCompare;
  groupBy: StatGroupBy;
  filters: Partial<Record<StatFilterKey, string[]>>;
  vehicleId: string;
  date: string;
}

/** The screen's state read from the URL, with defaults (Vue globale, ce mois, comparé). */
export function useStatsState(): [StatsState, (patch: Partial<StatsUrl>) => void] {
  const [url, setUrl] = useUrlFilters(STATS_URL_FILTERS);
  const today = todayInAlgiers();
  const period = (url.period || 'month') as StatPeriod;
  const custom = period === 'custom' && url.from !== '' && url.to !== '' && url.from <= url.to;
  const range = custom
    ? { from: url.from, to: url.to }
    : periodRange(period === 'custom' ? 'month' : period, today);
  const filters: StatsState['filters'] = {};
  for (const key of STAT_FILTER_KEYS) {
    const values = url[key].split(',').filter(Boolean);
    if (values.length > 0) filters[key] = values;
  }
  return [
    {
      view: (url.view || 'global') as StatView,
      period: custom ? 'custom' : period === 'custom' ? 'month' : period,
      range,
      compare: (url.compare || 'previous') as StatCompare,
      groupBy: (url.groupBy || 'day') as StatGroupBy,
      filters,
      vehicleId: url.vehicleId,
      date: url.date || today,
    },
    setUrl,
  ];
}

export function filterCount(filters: StatsState['filters']): number {
  return Object.values(filters).reduce((n, v) => n + (v?.length ?? 0), 0);
}

/** The API query string of a state, plus a view's own keys. */
export function statsQuery(state: StatsState, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({
    from: state.range.from,
    to: state.range.to,
    compare: state.compare,
    groupBy: state.groupBy,
  });
  for (const [key, values] of Object.entries(state.filters)) {
    if (values && values.length > 0) q.set(key, values.join(','));
  }
  for (const [key, value] of Object.entries(extra)) if (value) q.set(key, value);
  return q.toString();
}

// ---------------------------------------------------------------- data

export const statsKeys = {
  all: ['distribution-stats'] as const,
  one: (path: string, query: string) => ['distribution-stats', path, query] as const,
  targets: (period: string) => ['vehicle-targets', period] as const,
  segments: ['client-segments'] as const,
};

/** One statistics endpoint; the previous answer stays on screen while the next loads. */
export function useStats<T>(path: string, query: string, enabled = true) {
  return useQuery({
    queryKey: statsKeys.one(path, query),
    queryFn: ({ signal }) => api.request<T>(`/stats/distribution/${path}?${query}`, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Saves a view as .xlsx (the API builds the same rows as the view). */
export async function downloadStats(view: string, query: string): Promise<void> {
  const blob = await api.download(`/stats/distribution/export.xlsx?view=${view}&${query}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `statistiques-${view}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useVehicleTargets(period: string, enabled = true) {
  return useQuery({
    queryKey: statsKeys.targets(period),
    queryFn: ({ signal }) =>
      api.request<VehicleTargetsDto>(`/vehicle-targets?period=${period}`, { signal }),
    enabled,
  });
}

export function useSaveVehicleTargets() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PutVehicleTargetsInput) =>
      api.request<VehicleTargetsDto>('/vehicle-targets', { method: 'PUT', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['vehicle-targets'] });
      void client.invalidateQueries({ queryKey: statsKeys.all });
    },
  });
}

export function useCopyVehicleTargets() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (period: string) =>
      api.request<VehicleTargetsDto>('/vehicle-targets/copy-previous', {
        method: 'POST',
        body: { period },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['vehicle-targets'] });
      void client.invalidateQueries({ queryKey: statsKeys.all });
    },
  });
}

export function useClientSegments(enabled = true) {
  return useQuery({
    queryKey: statsKeys.segments,
    queryFn: ({ signal }) => api.request<ClientSegmentDto[]>('/client-segments', { signal }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Who opens /statistiques: the module, the reports, and not a seller or a livreur. */
export function useHasDistributionStats(): boolean {
  const { state } = useAuth();
  const on = useFeature(Feature.DISTRIBUTION_STATS);
  const reports = usePermission(Permission.REPORTS_VIEW);
  if (state.status !== 'authenticated') return false;
  const road = state.user.role === Role.SELLER || state.user.role === Role.LIVREUR;
  return on && reports && !road;
}

// ---------------------------------------------------------------- display

const NBSP = '\u00a0';
const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);

/** "1 234,5" from an API decimal string, keeping its decimals. */
function decimal(value: string): string {
  const negative = value.startsWith('-');
  const [int = '0', dec] = (negative ? value.slice(1) : value).split('.');
  return `${negative ? '-' : ''}${group(int)}${dec ? `,${dec}` : ''}`;
}

/**
 * A figure as the screen prints it: `1 234 567,89 DA`, `12,350 t`, `87,5 %`. The API sent
 * it already rounded; this only formats. null → "—".
 */
export function formatStat(value: string | null | undefined, unit: StatUnit): string {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case StatUnit.DA:
      return formatDA(value);
    case StatUnit.TONNE:
      return `${decimal(value)}${NBSP}t`;
    case StatUnit.PERCENT:
      return `${decimal(value)}${NBSP}%`;
    default:
      return decimal(value);
  }
}

export function cellOf(cells: readonly StatCell[], measure: StatMeasure): StatCell | undefined {
  return cells.find((c) => c.measure === measure);
}

/** A cell's value for drawing a mark (a display ratio, never money maths). */
export function plotValue(cell: StatCell | undefined): number {
  if (!cell?.value) return 0;
  const n = Number(cell.value);
  return Number.isFinite(n) ? n : 0;
}
