'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  type ClientMapDto,
  type ClientMapPointDto,
  type ClientNearbyBody,
  type ClientNearbyPointDto,
  Feature,
  type LatLng,
  money,
} from '@erp/shared';
import { api } from './api-client';
import { useFeature } from './auth';

/** Filters of the client map (phase 35), the same as the client list's. */
export interface ClientMapFilters {
  search?: string;
  sectorId?: string;
  assignedSellerId?: string;
  hasDebt?: boolean;
  overLimit?: boolean;
  includeInactive?: boolean;
}

/** A view box, rounded so a tiny pan does not make a new query. */
export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export const clientMapKeys = {
  all: ['clients', 'map'] as const,
  map: (f: ClientMapFilters, b: MapBounds | null) => ['clients', 'map', f, b] as const,
  nearby: (f: ClientMapFilters, at: LatLng | null, radiusM: number) =>
    ['clients', 'nearby', f, at, radiusM] as const,
};

function filterParams(f: ClientMapFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search) p.set('search', f.search);
  if (f.sectorId) p.set('sectorId', f.sectorId);
  if (f.assignedSellerId) p.set('assignedSellerId', f.assignedSellerId);
  if (f.hasDebt) p.set('hasDebt', 'true');
  if (f.overLimit) p.set('overLimit', 'true');
  if (f.includeInactive) p.set('includeInactive', 'true');
  return p;
}

/** Rounds a box outwards to 3 decimals (about 100 m). */
export function roundBounds(b: MapBounds): MapBounds {
  const down = (v: number) => Math.floor(v * 1000) / 1000;
  const up = (v: number) => Math.ceil(v * 1000) / 1000;
  return {
    minLat: Math.max(-90, down(b.minLat)),
    minLng: Math.max(-180, down(b.minLng)),
    maxLat: Math.min(90, up(b.maxLat)),
    maxLng: Math.min(180, up(b.maxLng)),
  };
}

/** `bounds` null = every point of the scope (the first load). */
export function useClientMap(filters: ClientMapFilters, bounds: MapBounds | null, enabled = true) {
  const on = useFeature(Feature.GEO_CHECK);
  return useQuery({
    queryKey: clientMapKeys.map(filters, bounds),
    queryFn: ({ signal }) => {
      const p = filterParams(filters);
      if (bounds) for (const [k, v] of Object.entries(bounds)) p.set(k, String(v));
      return api.request<ClientMapDto>(`/clients/map?${p.toString()}`, { signal });
    },
    enabled: on && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * The map's data for a screen that pans and zooms: the whole scope first; when more clients
 * match than the cap, the current view only (the bounds of the last pan / zoom, which the
 * map debounces), so that "zoomez" really brings the missing clients in.
 * Used by `/clients/carte` and by the route editor's picker: both show the same banner.
 */
export function useClientMapByView(filters: ClientMapFilters, enabled = true) {
  /** The view as the map reports it; the query rounds it so that small pans share a key. */
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const rounded = useMemo(() => (bounds ? roundBounds(bounds) : null), [bounds]);
  const whole = useClientMap(filters, null, enabled);
  const byView = (whole.data?.truncated ?? false) && rounded !== null;
  const inView = useClientMap(filters, rounded, enabled && byView);
  const onBoundsChange = useCallback((b: MapBounds) => setBounds(b), []);
  return { map: byView ? inView : whole, bounds, onBoundsChange };
}

/**
 * The position is sent only in the body of this one request, never stored. In the body and
 * not in the URL: the hosting platform logs the URL of every request (REPORT-35, B-3).
 */
export function useNearbyClients(filters: ClientMapFilters, at: LatLng | null, radiusM: number) {
  const on = useFeature(Feature.GEO_CHECK);
  return useQuery({
    queryKey: clientMapKeys.nearby(filters, at, radiusM),
    queryFn: ({ signal }) => {
      const body: ClientNearbyBody = {
        ...(filters.search ? { search: filters.search } : {}),
        ...(filters.sectorId ? { sectorId: filters.sectorId } : {}),
        ...(filters.assignedSellerId ? { assignedSellerId: filters.assignedSellerId } : {}),
        hasDebt: filters.hasDebt === true,
        overLimit: filters.overLimit === true,
        includeInactive: filters.includeInactive === true,
        lat: at!.lat,
        lng: at!.lng,
        radiusM,
        limit: 50,
      };
      return api.request<ClientNearbyPointDto[]>('/clients/nearby', {
        method: 'POST',
        body,
        signal,
      });
    },
    enabled: on && at !== null,
  });
}

/** How a point is drawn; the bubble and the legend say it in words too. */
export type PointState = 'normal' | 'debt' | 'over' | 'inactive';

export function pointState(p: Pick<ClientMapPointDto, 'active' | 'overLimit' | 'balance'>) {
  if (!p.active) return 'inactive' as const;
  if (p.overLimit) return 'over' as const;
  if (money(p.balance).gt(0)) return 'debt' as const;
  return 'normal' as const;
}

export interface MyPosition extends LatLng {
  accuracyM: number;
}

export type PositionStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable';

/**
 * The browser position for "Près de moi" (high accuracy, 10 s). Kept in memory only: not
 * stored, not sent anywhere but the nearby query.
 */
export function useMyPosition() {
  const [position, setPosition] = useState<MyPosition | null>(null);
  const [status, setStatus] = useState<PositionStatus>('idle');
  const locate = useCallback(
    () =>
      new Promise<MyPosition | null>((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setStatus('unavailable');
          resolve(null);
          return;
        }
        setStatus('locating');
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const pos = {
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracyM: Math.round(p.coords.accuracy),
            };
            setPosition(pos);
            setStatus('ok');
            resolve(pos);
          },
          (err) => {
            setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
        );
      }),
    [],
  );
  return { position, status, locate };
}
