'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracyM?: number | null;
}

export interface GeoMapProps {
  client: GeoPoint | null;
  operation?: GeoPoint | null;
  labels: { client: string; operation: string };
  className?: string;
}

// Leaflet touches `window`: loaded in the browser only, and only on pages that show a map.
const GeoMapInner = dynamic(() => import('./geo-map'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

export function GeoMap({ className, ...props }: GeoMapProps) {
  const h = cn('h-56 w-full overflow-hidden rounded-md border md:h-72', className);
  return (
    <div className={cn(h, 'isolate')}>
      <GeoMapInner {...props} className="size-full" />
    </div>
  );
}
