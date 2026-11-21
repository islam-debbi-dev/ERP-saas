import 'package:json_annotation/json_annotation.dart';

part 'geo_point.g.dart';

/// `{ lat, lng }` as stored on stores, addresses and order customers.
@JsonSerializable()
class GeoPoint {
  final double lat;
  final double lng;

  const GeoPoint({required this.lat, required this.lng});

  /// Backend sub-documents may exist with neither coordinate set.
  static GeoPoint? maybeFromJson(dynamic json) {
    if (json is! Map<String, dynamic>) return null;
    if (json['lat'] is! num || json['lng'] is! num) return null;
    return GeoPoint.fromJson(json);
  }

  factory GeoPoint.fromJson(Map<String, dynamic> json) =>
      _$GeoPointFromJson(json);

  Map<String, dynamic> toJson() => _$GeoPointToJson(this);
}
