import 'package:decimal/decimal.dart';

import '../network/api_client.dart';
import '../network/api_result.dart';
import 'map_box.dart';

/// A client on the map (`ClientMapPointDto`, phase 35). Coordinates are
/// positions, not money: `double` is right; the balance is a Decimal.
class ClientMapPoint {
  const ClientMapPoint({
    required this.id,
    required this.code,
    required this.name,
    required this.lat,
    required this.lng,
    required this.balance,
    this.commune,
    this.phone,
    this.active = true,
    this.overLimit = false,
    this.assignedSellerId,
  });

  final String id;
  final String code;
  final String name;
  final String? commune;
  final String? phone;
  final double lat;
  final double lng;
  final bool active;
  final Decimal balance;
  final bool overLimit;
  final String? assignedSellerId;

  factory ClientMapPoint.fromJson(Map<String, dynamic> json) => ClientMapPoint(
    id: json['id'] as String,
    code: json['code'] as String,
    name: json['name'] as String,
    commune: json['commune'] as String?,
    phone: json['phone'] as String?,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    active: json['active'] as bool? ?? true,
    balance: Decimal.parse(json['balance'] as String),
    overLimit: json['overLimit'] as bool? ?? false,
    assignedSellerId: json['assignedSellerId'] as String?,
  );
}

/// `ClientMapDto`: the points (at most 2000), whether more matched, and how
/// many matching clients have no point yet.
class ClientMapData {
  const ClientMapData({
    this.points = const [],
    this.truncated = false,
    this.withoutLocation = 0,
  });

  final List<ClientMapPoint> points;

  /// More clients matched than the cap: zoom in or filter.
  final bool truncated;
  final int withoutLocation;

  factory ClientMapData.fromJson(Map<String, dynamic> json) => ClientMapData(
    points: [
      for (final p in json['points'] as List<dynamic>? ?? const [])
        ClientMapPoint.fromJson(p as Map<String, dynamic>),
    ],
    truncated: json['truncated'] as bool? ?? false,
    withoutLocation: (json['withoutLocation'] as num?)?.toInt() ?? 0,
  );

  Map<String, ClientMapPoint> get byId => {for (final p in points) p.id: p};
}

/// The list filters `/clients/map` shares with `/clients`.
class ClientMapFilters {
  const ClientMapFilters({
    this.assignedSellerId,
    this.hasDebt = false,
    this.overLimit = false,
    this.includeInactive = false,
  });

  final String? assignedSellerId;
  final bool hasDebt;
  final bool overLimit;
  final bool includeInactive;

  ClientMapFilters copyWith({
    String? Function()? assignedSellerId,
    bool? hasDebt,
    bool? overLimit,
  }) => ClientMapFilters(
    assignedSellerId: assignedSellerId == null
        ? this.assignedSellerId
        : assignedSellerId(),
    hasDebt: hasDebt ?? this.hasDebt,
    overLimit: overLimit ?? this.overLimit,
    includeInactive: includeInactive,
  );

  Map<String, Object> toQuery() => {
    'assignedSellerId': ?assignedSellerId,
    if (hasDebt) 'hasDebt': 'true',
    if (overLimit) 'overLimit': 'true',
    if (includeInactive) 'includeInactive': 'true',
  };

  @override
  bool operator ==(Object other) =>
      other is ClientMapFilters &&
      other.assignedSellerId == assignedSellerId &&
      other.hasDebt == hasDebt &&
      other.overLimit == overLimit &&
      other.includeInactive == includeInactive;

  @override
  int get hashCode =>
      Object.hash(assignedSellerId, hasDebt, overLimit, includeInactive);
}

/// `GET /clients/map` (GEO_CHECK), within the caller's scope (the API's).
/// Only the view box leaves the phone, never the user's own position; the
/// API strips the box from its logs too (position privacy, phase 35).
class ClientMapRepository {
  ClientMapRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<ClientMapData>> map({
    ClientMapFilters filters = const ClientMapFilters(),
    MapBox? box,
  }) => _api.get(
    '/clients/map',
    query: {...filters.toQuery(), ...?box?.toQuery()},
    decode: (json) => ClientMapData.fromJson(json.asMap),
  );
}
