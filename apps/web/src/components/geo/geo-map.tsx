'use client';

import 'leaflet/dist/leaflet.css';
import { latLngBounds } from 'leaflet';
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import type { GeoMapProps } from './geo-map-lazy';

const CLIENT_COLOR = '#1d4ed8';
const OPERATION_COLOR = '#b45309';

/**
 * Leaflet map with OpenStreetMap tiles (phase 17): the client's saved point, the point of
 * the operation with its accuracy circle, and the line between them. Labels say what each
 * point is, so the colours are never the only clue.
 */
export default function GeoMap({ client, operation, labels, className }: GeoMapProps) {
  const points = [client, operation].filter((p): p is NonNullable<typeof p> => !!p);
  const first = points[0];
  if (!first) return null;
  const bounds = points.length > 1 ? latLngBounds(points.map((p) => [p.lat, p.lng])) : undefined;
  return (
    <MapContainer
      className={className}
      center={[first.lat, first.lng]}
      zoom={16}
      bounds={bounds}
      boundsOptions={{ padding: [32, 32], maxZoom: 17 }}
      scrollWheelZoom={false}
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {client && operation ? (
        <Polyline
          positions={[
            [client.lat, client.lng],
            [operation.lat, operation.lng],
          ]}
          pathOptions={{ color: OPERATION_COLOR, weight: 2, dashArray: '6 6' }}
        />
      ) : null}
      {operation?.accuracyM ? (
        <Circle
          center={[operation.lat, operation.lng]}
          radius={operation.accuracyM}
          pathOptions={{ color: OPERATION_COLOR, weight: 1, fillOpacity: 0.1 }}
        />
      ) : null}
      {client ? (
        <CircleMarker
          center={[client.lat, client.lng]}
          radius={9}
          pathOptions={{ color: '#fff', weight: 2, fillColor: CLIENT_COLOR, fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]}>
            {labels.client}
          </Tooltip>
        </CircleMarker>
      ) : null}
      {operation ? (
        <CircleMarker
          center={[operation.lat, operation.lng]}
          radius={9}
          pathOptions={{ color: '#fff', weight: 2, fillColor: OPERATION_COLOR, fillOpacity: 1 }}
        >
          <Tooltip permanent direction="bottom" offset={[0, 8]}>
            {labels.operation}
          </Tooltip>
        </CircleMarker>
      ) : null}
    </MapContainer>
  );
}
