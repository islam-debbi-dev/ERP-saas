// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me_day.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MeDay _$MeDayFromJson(Map<String, dynamic> json) => MeDay(
  day: json['day'] as String,
  expected: ExpectedCash.fromJson(json['expected'] as Map<String, dynamic>),
  vehicle: _vehicle(json['vehicle']),
  session: json['session'] == null
      ? null
      : DaySession.fromJson(json['session'] as Map<String, dynamic>),
  stock:
      (json['stock'] as List<dynamic>?)
          ?.map((e) => TruckStockLine.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  transfers:
      (json['transfers'] as List<dynamic>?)
          ?.map((e) => DayTransfer.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

ExpectedCash _$ExpectedCashFromJson(Map<String, dynamic> json) => ExpectedCash(
  fromSales: const DecimalConverter().fromJson(json['fromSales'] as String),
  fromVersements: const DecimalConverter().fromJson(
    json['fromVersements'] as String,
  ),
  total: const DecimalConverter().fromJson(json['total'] as String),
);

DaySession _$DaySessionFromJson(Map<String, dynamic> json) => DaySession(
  id: json['id'] as String,
  status: json['status'] as String,
  handedCash: const NullableDecimalConverter().fromJson(
    json['handedCash'] as String?,
  ),
  ecart: const NullableDecimalConverter().fromJson(json['ecart'] as String?),
  closedAt: json['closedAt'] == null
      ? null
      : DateTime.parse(json['closedAt'] as String),
);

TruckStockLine _$TruckStockLineFromJson(Map<String, dynamic> json) =>
    TruckStockLine(
      productId: json['productId'] as String,
      reference: json['reference'] as String,
      designation: json['designation'] as String,
      unitCode: json['unitCode'] as String,
      qtyBase: const DecimalConverter().fromJson(json['qtyBase'] as String),
    );

DayTransfer _$DayTransferFromJson(Map<String, dynamic> json) => DayTransfer(
  id: json['id'] as String,
  type: json['type'] as String,
  validatedAt: DateTime.parse(json['validatedAt'] as String),
  from: _named(json['from']),
  to: _named(json['to']),
  number: json['number'] as String?,
  lines:
      (json['lines'] as List<dynamic>?)
          ?.map((e) => TransferLine.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

TransferLine _$TransferLineFromJson(Map<String, dynamic> json) => TransferLine(
  productId: json['productId'] as String,
  designation: json['designation'] as String,
  unitCode: json['unitCode'] as String,
  qty: const DecimalConverter().fromJson(json['qty'] as String),
  qtyBase: const DecimalConverter().fromJson(json['qtyBase'] as String),
);
