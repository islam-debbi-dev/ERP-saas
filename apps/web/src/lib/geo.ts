'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  Feature,
  type GeoCheckPage,
  type GeoInput,
  type GeoReviewStatus,
  type GeoStatus,
  type LocationRequestDto,
  Role,
} from '@erp/shared';
import { api } from './api-client';
import { useAuth, useFeature } from './auth';

export const geoKeys = {
  all: ['geo'] as const,
  checks: (filters: GeoCheckFilters) => ['geo', 'checks', filters] as const,
  requests: (clientId?: string) => ['geo', 'requests', clientId ?? 'all'] as const,
};

export interface GeoCheckFilters {
  status?: GeoStatus;
  reviewStatus?: GeoReviewStatus;
}

/** Roles whose operations the API checks (it decides; this only avoids asking for nothing). */
const FIELD_ROLES = new Set<string>([Role.SELLER, Role.PREVENDEUR, Role.LIVREUR]);

/** True when this user's sales, versements and visits carry the phone's position. */
export function useGeoCaptureOn(): boolean {
  const on = useFeature(Feature.GEO_CHECK);
  const role = useAuth().state.user?.role;
  return on && !!role && FIELD_ROLES.has(role);
}

/**
 * The phone's position, once, at the moment of the operation (never tracked, law 18-07).
 * No position (refused, no signal, timeout) gives null: the API records NO_SIGNAL and
 * asks for a note, the sale is never blocked here.
 */
export function capturePosition(timeoutMs = 10_000): Promise<GeoInput | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.round(p.coords.accuracy),
          // A browser cannot tell a mock location; the Android app sends the real flag.
          isMocked: false,
          capturedAt: new Date(p.timestamp || Date.now()).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function useGeoCheckPages(filters: GeoCheckFilters) {
  const on = useFeature(Feature.GEO_CHECK);
  return useInfiniteQuery({
    queryKey: geoKeys.checks(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (filters.status) params.set('status', filters.status);
      if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<GeoCheckPage>(`/geo-checks?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: on,
  });
}

export function useLocationRequests(clientId?: string) {
  const on = useFeature(Feature.GEO_CHECK);
  return useQuery({
    queryKey: geoKeys.requests(clientId),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ status: 'PENDING' });
      if (clientId) params.set('clientId', clientId);
      return api.request<LocationRequestDto[]>(`/location-requests?${params.toString()}`, {
        signal,
      });
    },
    enabled: on,
  });
}
