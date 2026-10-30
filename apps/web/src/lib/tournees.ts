'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type DelivererDto,
  Feature,
  type OrderDto,
  type OrderPage,
  type OrderStatus,
  type RouteDto,
  type SellerDayDto,
  type TodayDto,
  type TourneeReportDto,
  type UpdateOrderInput,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature } from './auth';

export const tourneeKeys = {
  routes: ['routes'] as const,
  route: (id: string) => ['routes', id] as const,
  today: ['me', 'today'] as const,
  orders: ['orders'] as const,
  orderList: (filters: OrderFilters) => ['orders', 'list', filters] as const,
  order: (id: string) => ['orders', id] as const,
  deliverers: ['orders', 'deliverers'] as const,
  sessions: (date: string) => ['seller-sessions', date] as const,
  allSessions: ['seller-sessions'] as const,
  report: (from: string, to: string, sellerId: string) =>
    ['tournees', 'report', { from, to, sellerId }] as const,
};

export interface OrderFilters {
  status?: OrderStatus;
  livreurId?: string;
}

export function useRoutes() {
  const on = useFeature(Feature.TOURNEES);
  return useQuery({
    queryKey: tourneeKeys.routes,
    queryFn: ({ signal }) => api.request<RouteDto[]>('/routes', { signal }),
    enabled: on,
  });
}

export function useRoute(id: string) {
  return useQuery({
    queryKey: tourneeKeys.route(id),
    queryFn: ({ signal }) => api.request<RouteDto>(`/routes/${id}`, { signal }),
  });
}

export function useToday() {
  const on = useFeature(Feature.TOURNEES);
  return useQuery({
    queryKey: tourneeKeys.today,
    queryFn: ({ signal }) => api.request<TodayDto>('/me/today', { signal }),
    enabled: on,
  });
}

export function useOrderPages(filters: OrderFilters = {}) {
  const on = useFeature(Feature.TOURNEES);
  return useInfiniteQuery({
    queryKey: tourneeKeys.orderList(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (filters.status) params.set('status', filters.status);
      if (filters.livreurId) params.set('livreurId', filters.livreurId);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<OrderPage>(`/orders?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: on,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: tourneeKeys.order(id),
    queryFn: ({ signal }) => api.request<OrderDto>(`/orders/${id}`, { signal }),
  });
}

/** Livreurs and sellers an order can be put on (planners only). */
export function useDeliverers(enabled = true) {
  return useQuery({
    queryKey: tourneeKeys.deliverers,
    queryFn: ({ signal }) => api.request<DelivererDto[]>('/orders/deliverers', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

/** Replaces the whole draft (header and lines). */
export function saveOrder(id: string, body: UpdateOrderInput) {
  return api.request<OrderDto>(`/orders/${id}`, { method: 'PUT', body });
}

export function useSellerDays(date: string) {
  return useQuery({
    queryKey: tourneeKeys.sessions(date),
    queryFn: ({ signal }) =>
      api.request<SellerDayDto[]>(`/seller-sessions?date=${encodeURIComponent(date)}`, { signal }),
  });
}

export function useTourneeReport(from: string, to: string, sellerId: string) {
  return useQuery({
    queryKey: tourneeKeys.report(from, to, sellerId),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ from, to });
      if (sellerId) params.set('sellerId', sellerId);
      return api.request<TourneeReportDto>(`/tournees/reports?${params.toString()}`, { signal });
    },
    enabled: from <= to,
  });
}
