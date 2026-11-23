import 'dart:math' as math;

import 'package:decimal/decimal.dart';

import '../../../core/models/json_converters.dart';
import '../../../core/models/paginated.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';

UserRef? _user(Object? v) =>
    v == null ? null : UserRef.fromJson(v as Map<String, dynamic>);

double? _num(Object? v) => (v as num?)?.toDouble();

/// `{ id, code, name }` of a client.
class ClientRef {
  const ClientRef({required this.id, required this.code, required this.name});

  final String id;
  final String code;
  final String name;

  factory ClientRef.fromJson(Map<String, dynamic> json) => ClientRef(
    id: json['id'] as String,
    code: json['code'] as String,
    name: json['name'] as String,
  );
}

/// A field user's request to move a client's pin (`LocationRequestDto`).
/// Coordinates are positions, not money: `double` is right here.
class LocationRequest {
  const LocationRequest({
    required this.id,
    required this.client,
    required this.lat,
    required this.lng,
    required this.status,
    required this.requestedAt,
    required this.canDecide,
    this.accuracyM,
    this.previousLat,
    this.previousLng,
    this.note,
    this.requestedBy,
  });

  final String id;
  final ClientRef client;
  final double lat;
  final double lng;
  final double? accuracyM;
  final double? previousLat;
  final double? previousLng;
  final String? note;
  final String status;
  final UserRef? requestedBy;
  final DateTime requestedAt;

  /// The API says whether this user may approve or reject it.
  final bool canDecide;

  bool get hasPrevious => previousLat != null && previousLng != null;

  /// Metres between the client's current pin and the requested one.
  double? get movedM =>
      hasPrevious ? distanceM(previousLat!, previousLng!, lat, lng) : null;

  factory LocationRequest.fromJson(Map<String, dynamic> json) {
    final prev = json['previous'] as Map<String, dynamic>?;
    return LocationRequest(
      id: json['id'] as String,
      client: ClientRef.fromJson(json['client'] as Map<String, dynamic>),
      lat: _num(json['lat'])!,
      lng: _num(json['lng'])!,
      accuracyM: _num(json['accuracyM']),
      previousLat: _num(prev?['lat']),
      previousLng: _num(prev?['lng']),
      note: json['note'] as String?,
      status: json['status'] as String,
      requestedBy: _user(json['requestedBy']),
      requestedAt: DateTime.parse(json['requestedAt'] as String),
      canDecide: json['canDecide'] as bool? ?? false,
    );
  }
}

/// Great-circle distance in metres (haversine).
double distanceM(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371000.0;
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(lat2 - lat1);
  final dLng = rad(lng2 - lng1);
  final a =
      math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(rad(lat1)) *
          math.cos(rad(lat2)) *
          math.sin(dLng / 2) *
          math.sin(dLng / 2);
  return 2 * r * math.asin(math.sqrt(a));
}

/// A flagged operation of the team (`GeoCheckDto`), read only: the verdict
/// (`POST /geo-checks/:id/review`) belongs to owners and managers.
class GeoFlagItem {
  const GeoFlagItem({
    required this.id,
    required this.refType,
    required this.status,
    required this.receivedAt,
    required this.isMocked,
    required this.reviewStatus,
    this.refNumber,
    this.user,
    this.client,
    this.distanceM,
    this.accuracyM,
    this.note,
    this.flags = const [],
    this.lat,
    this.lng,
    this.clientLat,
    this.clientLng,
  });

  final String id;
  final String refType;
  final String? refNumber;
  final UserRef? user;
  final ClientRef? client;
  final double? distanceM;
  final double? accuracyM;
  final bool isMocked;
  final DateTime receivedAt;
  final String status;
  final List<String> flags;
  final String? note;

  /// NONE until a manager gives the verdict.
  final String reviewStatus;

  /// Where the operation was made (null without a fix) and the client's
  /// saved point (null when he has none): the API sends both.
  final double? lat;
  final double? lng;
  final double? clientLat;
  final double? clientLng;

  bool get hasPoint => lat != null && lng != null;
  bool get hasClientPoint => clientLat != null && clientLng != null;

  factory GeoFlagItem.fromJson(Map<String, dynamic> json) {
    final client = json['client'] as Map<String, dynamic>?;
    return GeoFlagItem(
      id: json['id'] as String,
      refType: json['refType'] as String,
      refNumber: json['refNumber'] as String?,
      user: _user(json['user']),
      client: client == null ? null : ClientRef.fromJson(client),
      distanceM: _num(json['distanceM']),
      accuracyM: _num(json['accuracyM']),
      isMocked: json['isMocked'] as bool? ?? false,
      receivedAt: DateTime.parse(json['receivedAt'] as String),
      status: json['status'] as String,
      flags: [
        for (final f in json['flags'] as List<dynamic>? ?? []) f as String,
      ],
      note: json['note'] as String?,
      reviewStatus: json['reviewStatus'] as String? ?? 'NONE',
      lat: _num(json['lat']),
      lng: _num(json['lng']),
      clientLat: _num(client?['lat']),
      clientLng: _num(client?['lng']),
    );
  }
}

/// One member's day in the tournée report (`TourneeReportRowDto`).
class TourneeReportRow {
  const TourneeReportRow({
    required this.seller,
    required this.plannedStops,
    required this.visitedStops,
    required this.visits,
    required this.productiveVisits,
    required this.orders,
    required this.delivered,
    required this.deliveredTtc,
    required this.shortLines,
    required this.closings,
    required this.ecart,
    this.visitRate,
    this.strikeRate,
  });

  final UserRef seller;
  final int plannedStops;
  final int visitedStops;

  /// 0..1 ratios from the API; null without a base.
  final double? visitRate;
  final int visits;
  final int productiveVisits;
  final double? strikeRate;
  final int orders;
  final int delivered;
  final Decimal deliveredTtc;
  final int shortLines;
  final int closings;
  final Decimal ecart;

  factory TourneeReportRow.fromJson(Map<String, dynamic> json) =>
      TourneeReportRow(
        seller: UserRef.fromJson(json['seller'] as Map<String, dynamic>),
        plannedStops: json['plannedStops'] as int,
        visitedStops: json['visitedStops'] as int,
        visitRate: _num(json['visitRate']),
        visits: json['visits'] as int,
        productiveVisits: json['productiveVisits'] as int,
        strikeRate: _num(json['strikeRate']),
        orders: json['orders'] as int,
        delivered: json['delivered'] as int,
        deliveredTtc: Decimal.parse(json['deliveredTtc'] as String),
        shortLines: json['shortLines'] as int,
        closings: json['closings'] as int,
        ecart: Decimal.parse(json['ecart'] as String),
      );
}

/// The supervisor's Contrôles tab. Every list is kept to his team by the API.
class ControlsRepository {
  ControlsRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<List<LocationRequest>>> pendingRequests() => _api.get(
    '/location-requests',
    query: {'status': 'PENDING'},
    decode: (json) => [
      for (final r in json.asList) LocationRequest.fromJson(r.asMap),
    ],
  );

  /// Moves the client's pin to the requested point.
  Future<ApiResult<LocationRequest>> approve(String id) => _api.post(
    '/location-requests/$id/approve',
    decode: (json) => LocationRequest.fromJson(json.asMap),
  );

  Future<ApiResult<LocationRequest>> reject(String id, String reason) =>
      _api.post(
        '/location-requests/$id/reject',
        data: {'reason': reason.trim()},
        decode: (json) => LocationRequest.fromJson(json.asMap),
      );

  /// The team's flagged operations between [from] and [to] (Algiers days).
  Future<ApiResult<Paginated<GeoFlagItem>>> geoFlags({
    required String from,
    required String to,
    String? cursor,
  }) => _api.get(
    '/geo-checks',
    query: {'from': from, 'to': to, 'cursor': cursor, 'limit': 30},
    decode: (json) => Paginated.fromJson(json.asMap, GeoFlagItem.fromJson),
  );

  /// Today's tournée report, one row per member.
  Future<ApiResult<List<TourneeReportRow>>> report(String day) => _api.get(
    '/tournees/reports',
    query: {'from': day, 'to': day, 'by': 'seller'},
    decode: (json) => [
      for (final r in (json.asMap['rows'] as List<dynamic>))
        TourneeReportRow.fromJson(r as Map<String, dynamic>),
    ],
  );
}
