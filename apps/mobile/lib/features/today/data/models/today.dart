import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'today.g.dart';

/// The caller's tournée of today: `GET /me/today` (`TodayDto` in
/// `packages/shared/src/schemas/tournees.ts`).
@JsonSerializable(createToJson: false)
class Today {
  const Today({
    required this.day,
    required this.weekday,
    this.vehicle,
    this.routes = const [],
    this.stops = const [],
    this.planned = 0,
    this.visited = 0,
  });

  /// Algiers day, `YYYY-MM-DD`.
  final String day;
  final int weekday;

  /// The truck the user drives now; its tournées are his today.
  @JsonKey(fromJson: _vehicle)
  final VehicleRef? vehicle;
  @JsonKey(fromJson: _routes)
  final List<NamedRef> routes;

  /// In route order; a client on two routes appears once.
  final List<TodayStop> stops;
  final int planned;
  final int visited;

  factory Today.fromJson(Map<String, dynamic> json) => _$TodayFromJson(json);
}

VehicleRef? _vehicle(Object? json) =>
    json == null ? null : VehicleRef.fromJson(json as Map<String, dynamic>);

List<NamedRef> _routes(Object? json) => [
  for (final r in (json as List<dynamic>? ?? const []))
    NamedRef.fromJson(r as Map<String, dynamic>),
];

@JsonSerializable(createToJson: false)
class TodayStop {
  const TodayStop({
    required this.routeId,
    required this.position,
    required this.client,
    required this.balance,
    this.lastVisit,
    this.lastSale,
    this.visitedToday = false,
    this.today = const TodayDocs(),
  });

  final String routeId;
  final int position;
  final StopClient client;

  /// What the client owes (positive) or has in advance (negative).
  @DecimalConverter()
  final Decimal balance;
  final LastVisit? lastVisit;
  final LastSale? lastSale;
  final bool visitedToday;

  /// The caller's latest documents for this client today (linked to a visit).
  final TodayDocs today;

  factory TodayStop.fromJson(Map<String, dynamic> json) =>
      _$TodayStopFromJson(json);
}

@JsonSerializable(createToJson: false)
class StopClient {
  const StopClient({
    required this.id,
    required this.code,
    required this.name,
    this.phone,
    this.address,
    this.commune,
    this.lat,
    this.lng,
  });

  final String id;
  final String code;
  final String name;
  final String? phone;
  final String? address;
  final String? commune;
  final double? lat;
  final double? lng;

  factory StopClient.fromJson(Map<String, dynamic> json) =>
      _$StopClientFromJson(json);
}

@JsonSerializable(createToJson: false)
class LastVisit {
  const LastVisit({
    required this.id,
    required this.outcome,
    required this.startedAt,
    this.reason,
  });

  final String id;
  final String outcome;
  final String? reason;
  final DateTime startedAt;

  factory LastVisit.fromJson(Map<String, dynamic> json) =>
      _$LastVisitFromJson(json);
}

@JsonSerializable(createToJson: false)
class LastSale {
  const LastSale({
    required this.id,
    required this.totalTtc,
    required this.validatedAt,
    this.number,
  });

  final String id;
  final String? number;
  @DecimalConverter()
  final Decimal totalTtc;
  final DateTime validatedAt;

  factory LastSale.fromJson(Map<String, dynamic> json) =>
      _$LastSaleFromJson(json);
}

@JsonSerializable(createToJson: false)
class TodayDocs {
  const TodayDocs({this.saleId, this.orderId, this.paymentId});

  final String? saleId;
  final String? orderId;
  final String? paymentId;

  factory TodayDocs.fromJson(Map<String, dynamic> json) =>
      _$TodayDocsFromJson(json);
}
