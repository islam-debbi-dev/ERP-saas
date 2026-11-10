import type { PointState } from '@/lib/client-map';

/** Fill of a client point by state; contrast ≥ 3:1 against the map and white rings. */
export const POINT_COLORS: Record<PointState, string> = {
  normal: '#1d4ed8',
  debt: '#b45309',
  over: '#b91c1c',
  inactive: '#6b7280',
};
