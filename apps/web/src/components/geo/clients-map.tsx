'use client';

import 'leaflet/dist/leaflet.css';
import { canvas, divIcon, type LatLngBounds, latLngBounds, svg } from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { ClientsMapProps } from './clients-map-lazy';
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from './map-tiles';
import { POINT_COLORS } from './point-colors';

const ME_COLOR = '#0e7490';
const SVG_MAX = 500;
/** Algiers: where an empty map opens. */
const DEFAULT_CENTER: [number, number] = [36.7538, 3.0588];

/**
 * Many clients on one map (phase 35). Many plain points are canvas circles (`preferCanvas`)
 * so 2 000 of them stay smooth on a cheap phone; route stops are numbered DOM markers. The
 * colour is never the only clue: the number / check mark and the bubble say it in words.
 */
export default function ClientsMap({
  points,
  selectedId,
  onSelect,
  me,
  path,
  fitKey,
  focus,
  onBoundsChange,
  labels,
  className,
}: ClientsMapProps) {
  const bounds = useMemo(() => {
    const all = points.map((p) => [p.lat, p.lng] as [number, number]);
    if (me) all.push([me.lat, me.lng]);
    return all.length > 0 ? latLngBounds(all) : undefined;
    // Refit only when the caller says the set changed (not on every refetch of the view).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  const plain = points.filter((p) => p.number === undefined);
  // Canvas above SVG_MAX points (smooth on a cheap phone); SVG below, where each point is
  // its own element (`cp-<id>`), reachable by tests and assistive tools.
  const big = plain.length > SVG_MAX;
  const renderer = useMemo(() => (big ? canvas() : svg()), [big]);
  const numbered = points.filter((p) => p.number !== undefined);
  return (
    <MapContainer
      className={className}
      center={DEFAULT_CENTER}
      zoom={11}
      bounds={bounds}
      boundsOptions={{ padding: [32, 32], maxZoom: 16 }}
      preferCanvas
      attributionControl
    >
      <Refit bounds={bounds} />
      <Focus focus={focus} />
      {onBoundsChange ? <BoundsWatcher onChange={onBoundsChange} /> : null}
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={19} />
      {path && path.length > 1 ? (
        <Polyline
          positions={path.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: '#334155', weight: 2, dashArray: '6 6', opacity: 0.8 }}
        />
      ) : null}
      {me ? (
        <>
          <Circle
            center={[me.lat, me.lng]}
            radius={me.accuracyM}
            pathOptions={{ color: ME_COLOR, weight: 1, fillOpacity: 0.12 }}
          />
          <CircleMarker
            center={[me.lat, me.lng]}
            radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: ME_COLOR, fillOpacity: 1 }}
          />
        </>
      ) : null}
      {plain.map((p) => (
        <CircleMarker
          // The renderer is read once: a new one remounts the point.
          key={`${p.id}:${big}`}
          center={[p.lat, p.lng]}
          radius={p.id === selectedId ? 11 : 7}
          // Constructor options (pathOptions only go through setStyle).
          renderer={renderer}
          className={`cp-${p.id}`}
          pathOptions={{
            color: p.id === selectedId ? '#0f172a' : '#fff',
            weight: p.id === selectedId ? 3 : 1.5,
            fillColor: POINT_COLORS[p.state],
            fillOpacity: p.state === 'inactive' ? 0.6 : 0.95,
          }}
          eventHandlers={{ click: () => onSelect?.(p.id) }}
        />
      ))}
      {numbered.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={stopIcon(p.number!, p.checked === true, p.id === selectedId, labels?.stop)}
          eventHandlers={{ click: () => onSelect?.(p.id) }}
          keyboard
          title={p.title}
        />
      ))}
    </MapContainer>
  );
}

/** A numbered stop (its place in the tournée), or a check mark once visited today. */
function stopIcon(n: number, checked: boolean, selected: boolean, label?: string) {
  const size = selected ? 34 : 28;
  const text = checked ? '✓' : String(n);
  return divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span aria-label="${label ? `${label} ${n}` : n}" style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${checked ? '#15803d' : '#1e3a8a'};color:#fff;font:600 13px/1 system-ui,sans-serif;border:2px solid ${selected ? '#0f172a' : '#fff'};box-shadow:0 1px 3px rgb(0 0 0 / .35);font-variant-numeric:tabular-nums">${text}</span>`,
  });
}

/**
 * The map is often created inside a sheet that is still sliding in: measure again when the
 * box changes, and fit the points the first time and when the set changes.
 */
function Refit({ bounds }: { bounds: LatLngBounds | undefined }) {
  const map = useMap();
  const fitted = useRef<LatLngBounds | undefined>(undefined);
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (bounds && fitted.current !== bounds) {
        fitted.current = bounds;
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
      }
    };
    fit();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, bounds]);
  return null;
}

function Focus({ focus }: { focus: ClientsMapProps['focus'] }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), focus.zoom ?? 14));
  }, [map, focus]);
  return null;
}

/** Reports the view box after a pan or zoom, debounced 400 ms. */
function BoundsWatcher({ onChange }: { onChange: NonNullable<ClientsMapProps['onBoundsChange']> }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const map = useMapEvents({
    moveend: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const b = map.getBounds();
        onChange({
          minLat: b.getSouth(),
          minLng: b.getWest(),
          maxLat: b.getNorth(),
          maxLng: b.getEast(),
        });
      }, 400);
    },
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}
