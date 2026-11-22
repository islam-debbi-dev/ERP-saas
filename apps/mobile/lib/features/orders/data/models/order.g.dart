// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'order.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Order _$OrderFromJson(Map<String, dynamic> json) => Order(
  id: json['id'] as String,
  status: json['status'] as String,
  client: OrderClient.fromJson(json['client'] as Map<String, dynamic>),
  totalHt: const DecimalConverter().fromJson(json['totalHt'] as String),
  totalTva: const DecimalConverter().fromJson(json['totalTva'] as String),
  totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  version: (json['version'] as num).toInt(),
  number: json['number'] as String?,
  requestedDate: json['requestedDate'] as String?,
  note: json['note'] as String?,
  cancelReason: json['cancelReason'] as String?,
  lines:
      (json['lines'] as List<dynamic>?)
          ?.map((e) => OrderLine.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

OrderClient _$OrderClientFromJson(Map<String, dynamic> json) => OrderClient(
  id: json['id'] as String,
  code: json['code'] as String,
  name: json['name'] as String,
  phone: json['phone'] as String?,
);

OrderLine _$OrderLineFromJson(Map<String, dynamic> json) => OrderLine(
  id: json['id'] as String,
  position: (json['position'] as num).toInt(),
  productId: json['productId'] as String,
  designation: json['designation'] as String,
  unitCode: json['unitCode'] as String,
  qty: const DecimalConverter().fromJson(json['qty'] as String),
  unitPriceHt: const DecimalConverter().fromJson(json['unitPriceHt'] as String),
  discountPct: const DecimalConverter().fromJson(json['discountPct'] as String),
  lineHt: const DecimalConverter().fromJson(json['lineHt'] as String),
  isFree: json['isFree'] as bool? ?? false,
);

OrderSummary _$OrderSummaryFromJson(Map<String, dynamic> json) => OrderSummary(
  id: json['id'] as String,
  status: json['status'] as String,
  client: OrderClient.fromJson(json['client'] as Map<String, dynamic>),
  totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  number: json['number'] as String?,
  requestedDate: json['requestedDate'] as String?,
  lineCount: (json['lineCount'] as num?)?.toInt() ?? 0,
);
