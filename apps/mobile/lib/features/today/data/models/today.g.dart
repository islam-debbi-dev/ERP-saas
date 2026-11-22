// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'today.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Today _$TodayFromJson(Map<String, dynamic> json) => Today(
  day: json['day'] as String,
  weekday: (json['weekday'] as num).toInt(),
  vehicle: _vehicle(json['vehicle']),
  routes: json['routes'] == null ? const [] : _routes(json['routes']),
  stops:
      (json['stops'] as List<dynamic>?)
          ?.map((e) => TodayStop.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  planned: (json['planned'] as num?)?.toInt() ?? 0,
  visited: (json['visited'] as num?)?.toInt() ?? 0,
);

TodayStop _$TodayStopFromJson(Map<String, dynamic> json) => TodayStop(
  routeId: json['routeId'] as String,
  position: (json['position'] as num).toInt(),
  client: StopClient.fromJson(json['client'] as Map<String, dynamic>),
  balance: const DecimalConverter().fromJson(json['balance'] as String),
  lastVisit: json['lastVisit'] == null
      ? null
      : LastVisit.fromJson(json['lastVisit'] as Map<String, dynamic>),
  lastSale: json['lastSale'] == null
      ? null
      : LastSale.fromJson(json['lastSale'] as Map<String, dynamic>),
  visitedToday: json['visitedToday'] as bool? ?? false,
  today: json['today'] == null
      ? const TodayDocs()
      : TodayDocs.fromJson(json['today'] as Map<String, dynamic>),
);

StopClient _$StopClientFromJson(Map<String, dynamic> json) => StopClient(
  id: json['id'] as String,
  code: json['code'] as String,
  name: json['name'] as String,
  phone: json['phone'] as String?,
  address: json['address'] as String?,
  commune: json['commune'] as String?,
  lat: (json['lat'] as num?)?.toDouble(),
  lng: (json['lng'] as num?)?.toDouble(),
);

LastVisit _$LastVisitFromJson(Map<String, dynamic> json) => LastVisit(
  id: json['id'] as String,
  outcome: json['outcome'] as String,
  startedAt: DateTime.parse(json['startedAt'] as String),
  reason: json['reason'] as String?,
);

LastSale _$LastSaleFromJson(Map<String, dynamic> json) => LastSale(
  id: json['id'] as String,
  totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
  validatedAt: DateTime.parse(json['validatedAt'] as String),
  number: json['number'] as String?,
);

TodayDocs _$TodayDocsFromJson(Map<String, dynamic> json) => TodayDocs(
  saleId: json['saleId'] as String?,
  orderId: json['orderId'] as String?,
  paymentId: json['paymentId'] as String?,
);
