import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/map/app_map.dart';
import '../../../core/map/client_marker.dart';
import '../data/controls_repository.dart';

const _oldColor = Color(0xFF6B7280);
const _operationColor = Color(0xFFB45309);

/// A location request on a small map: the client's current pin (grey) and the
/// requested one (blue), joined by a dashed line. A first position shows the
/// requested point alone.
class LocationRequestMap extends StatelessWidget {
  const LocationRequestMap({super.key, required this.request});

  final LocationRequest request;

  @override
  Widget build(BuildContext context) {
    final r = request;
    final to = LatLng(r.lat, r.lng);
    final from = r.hasPrevious ? LatLng(r.previousLat!, r.previousLng!) : null;
    final oldLabel = context.tr('map.old_point');
    final newLabel = context.tr('map.new_point');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        MiniMap(
          key: ValueKey('request-map-${r.id}'),
          points: [?from, to],
          layers: [
            if (from != null)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: [from, to],
                    color: mapAccent,
                    strokeWidth: 2,
                    pattern: StrokePattern.dashed(segments: const [6, 6]),
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                if (from != null) dotMarker(from, _oldColor, label: oldLabel),
                dotMarker(to, mapBlue, label: newLabel),
              ],
            ),
          ],
        ),
        AppSpacing.gapXs,
        MapLegend(
          entries: [
            if (from != null) (color: _oldColor, label: oldLabel),
            (color: mapBlue, label: newLabel),
          ],
        ),
      ],
    );
  }
}

/// A GPS alert on a small map: the client's saved point and where the
/// operation was made, with the fix's accuracy. Nothing when the API has
/// neither point.
class GeoFlagMap extends StatelessWidget {
  const GeoFlagMap({super.key, required this.flag});

  final GeoFlagItem flag;

  @override
  Widget build(BuildContext context) {
    final f = flag;
    if (!f.hasPoint && !f.hasClientPoint) return const SizedBox.shrink();
    final client = f.hasClientPoint ? LatLng(f.clientLat!, f.clientLng!) : null;
    final op = f.hasPoint ? LatLng(f.lat!, f.lng!) : null;
    final clientLabel = context.tr('map.client_point');
    final opLabel = context.tr('map.operation_point');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        MiniMap(
          key: ValueKey('flag-map-${f.id}'),
          points: [?client, ?op],
          layers: [
            if (op != null && f.accuracyM != null)
              CircleLayer(
                circles: [
                  CircleMarker(
                    point: op,
                    radius: f.accuracyM!.clamp(5, 5000).toDouble(),
                    useRadiusInMeter: true,
                    color: _operationColor.withValues(alpha: 0.12),
                    borderColor: _operationColor.withValues(alpha: 0.5),
                    borderStrokeWidth: 1,
                  ),
                ],
              ),
            if (client != null && op != null)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: [client, op],
                    color: _operationColor,
                    strokeWidth: 2,
                    pattern: StrokePattern.dashed(segments: const [6, 6]),
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                if (client != null)
                  dotMarker(client, mapAccent, label: clientLabel),
                if (op != null) dotMarker(op, _operationColor, label: opLabel),
              ],
            ),
          ],
        ),
        AppSpacing.gapXs,
        MapLegend(
          entries: [
            if (client != null) (color: mapAccent, label: clientLabel),
            if (op != null) (color: _operationColor, label: opLabel),
          ],
        ),
        if (op == null)
          Text(
            context.tr('map.no_operation_point'),
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: context.textMuted),
          ),
      ],
    );
  }
}

/// Coloured dots with their meaning, under a mini map.
class MapLegend extends StatelessWidget {
  const MapLegend({super.key, required this.entries});

  final List<({Color color, String label})> entries;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(
      context,
    ).textTheme.bodySmall?.copyWith(color: context.textMuted);
    return Wrap(
      spacing: AppSpacing.md,
      runSpacing: AppSpacing.xxs,
      children: [
        for (final e in entries)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: e.color,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              Text(e.label, style: style),
            ],
          ),
      ],
    );
  }
}
