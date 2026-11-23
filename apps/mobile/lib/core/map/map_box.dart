import 'package:flutter_map/flutter_map.dart' show LatLngBounds;

/// A view box for `GET /clients/map` (`minLat/minLng/maxLat/maxLng`, all four
/// or none). Rounded outward to 2 decimals (about 1 km) so that small pans
/// ask the same question and the API's 30 s cache answers.
class MapBox {
  const MapBox({
    required this.minLat,
    required this.minLng,
    required this.maxLat,
    required this.maxLng,
  });

  final double minLat;
  final double minLng;
  final double maxLat;
  final double maxLng;

  /// The visible bounds, rounded outward and clamped to the world; null when
  /// the box is empty after clamping (the schema wants min < max).
  static MapBox? around(LatLngBounds b) =>
      rounded(south: b.south, west: b.west, north: b.north, east: b.east);

  static MapBox? rounded({
    required double south,
    required double west,
    required double north,
    required double east,
  }) {
    double down(double v) => (v * 100).floorToDouble() / 100;
    double up(double v) => (v * 100).ceilToDouble() / 100;
    final box = MapBox(
      minLat: down(south).clamp(-90.0, 90.0),
      minLng: down(west).clamp(-180.0, 180.0),
      maxLat: up(north).clamp(-90.0, 90.0),
      maxLng: up(east).clamp(-180.0, 180.0),
    );
    if (box.minLat >= box.maxLat || box.minLng >= box.maxLng) return null;
    return box;
  }

  Map<String, Object> toQuery() => {
    'minLat': _fixed(minLat),
    'minLng': _fixed(minLng),
    'maxLat': _fixed(maxLat),
    'maxLng': _fixed(maxLng),
  };

  static String _fixed(double v) => v.toStringAsFixed(2);

  @override
  bool operator ==(Object other) =>
      other is MapBox &&
      other.minLat == minLat &&
      other.minLng == minLng &&
      other.maxLat == maxLat &&
      other.maxLng == maxLng;

  @override
  int get hashCode => Object.hash(minLat, minLng, maxLat, maxLng);
}
