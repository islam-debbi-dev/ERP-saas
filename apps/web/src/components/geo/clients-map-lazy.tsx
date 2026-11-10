'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import type { MapBounds, PointState } from '@/lib/client-map';
import { cn } from '@/lib/utils';
import { POINT_COLORS } from './point-colors';

export interface ClientsMapPoint {
  id: string;
  lat: number;
  lng: number;
  state: PointState;
  /** Position on the tournée: drawn as a numbered marker. */
  number?: number;
  /** Visited today: the number becomes a check mark. */
  checked?: boolean;
  /** Read by screen readers on numbered markers. */
  title?: string;
}

export interface ClientsMapProps {
  points: ClientsMapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** The user's position with its accuracy circle. */
  me?: { lat: number; lng: number; accuracyM: number } | null;
  /** A dashed straight line through these points, in order (the tournée). */
  path?: { lat: number; lng: number }[];
  /** Change it to fit the map to the points again. */
  fitKey: string;
  /** A new object centres the map on it. */
  focus?: { lat: number; lng: number; zoom?: number } | null;
  onBoundsChange?: (b: MapBounds) => void;
  labels?: { stop: string };
  className?: string;
}

// Leaflet touches `window`: loaded in the browser only, on the pages that show a map.
const Inner = dynamic(() => import('./clients-map'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

/** The client map (phase 35). Controls stay physical (Leaflet); panels around use logical CSS. */
export function ClientsMap({ className, ...props }: ClientsMapProps) {
  return (
    <div className={cn('isolate overflow-hidden rounded-md border', className)}>
      <Inner {...props} className="size-full" />
    </div>
  );
}

/** What the colours mean, in words (status is never shown by colour alone). */
export function MapLegend({ states, className }: { states: PointState[]; className?: string }) {
  const t = useTranslations('clientMap');
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground', className)}>
      {states.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-3 rounded-full border border-white shadow-sm"
            style={{ background: POINT_COLORS[s] }}
          />
          {t(`state.${s}`)}
        </li>
      ))}
    </ul>
  );
}
