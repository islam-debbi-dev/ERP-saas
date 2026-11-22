// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Sale _$SaleFromJson(Map<String, dynamic> json) => Sale(
  id: json['id'] as String,
  type: json['type'] as String,
  status: json['status'] as String,
  documentDate: json['documentDate'] as String,
  totalHt: const DecimalConverter().fromJson(json['totalHt'] as String),
  totalTva: const DecimalConverter().fromJson(json['totalTva'] as String),
  totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
  timbre: const DecimalConverter().fromJson(json['timbre'] as String),
  paidAmount: const DecimalConverter().fromJson(json['paidAmount'] as String),
  number: json['number'] as String?,
  client: json['client'] == null
      ? null
      : SaleClientRef.fromJson(json['client'] as Map<String, dynamic>),
  paymentMode: json['paymentMode'] as String?,
  lines:
      (json['lines'] as List<dynamic>?)
          ?.map((e) => SaleLine.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  validatedAt: json['validatedAt'] == null
      ? null
      : DateTime.parse(json['validatedAt'] as String),
);

SaleLine _$SaleLineFromJson(Map<String, dynamic> json) => SaleLine(
  id: json['id'] as String,
  position: (json['position'] as num).toInt(),
  productId: json['productId'] as String,
  designation: json['designation'] as String,
  unitCode: json['unitCode'] as String,
  qty: const DecimalConverter().fromJson(json['qty'] as String),
  unitPriceHt: const DecimalConverter().fromJson(json['unitPriceHt'] as String),
  discountPct: const DecimalConverter().fromJson(json['discountPct'] as String),
  lineHt: const DecimalConverter().fromJson(json['lineHt'] as String),
  unitName: json['unitName'] as String?,
  isFree: json['isFree'] as bool? ?? false,
);
