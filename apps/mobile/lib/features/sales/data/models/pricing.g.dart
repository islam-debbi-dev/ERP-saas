// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pricing.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PricingPreview _$PricingPreviewFromJson(Map<String, dynamic> json) =>
    PricingPreview(
      totalHt: const DecimalConverter().fromJson(json['totalHt'] as String),
      totalTva: const DecimalConverter().fromJson(json['totalTva'] as String),
      totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
      lines:
          (json['lines'] as List<dynamic>?)
              ?.map((e) => PricedLine.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );

PricedLine _$PricedLineFromJson(Map<String, dynamic> json) => PricedLine(
  position: (json['position'] as num).toInt(),
  productId: json['productId'] as String,
  unitId: json['unitId'] as String,
  designation: json['designation'] as String,
  unitCode: json['unitCode'] as String,
  qty: const DecimalConverter().fromJson(json['qty'] as String),
  unitPriceHt: const DecimalConverter().fromJson(json['unitPriceHt'] as String),
  discountPct: const DecimalConverter().fromJson(json['discountPct'] as String),
  tvaRate: const DecimalConverter().fromJson(json['tvaRate'] as String),
  lineHt: const DecimalConverter().fromJson(json['lineHt'] as String),
  inputIndex: (json['inputIndex'] as num).toInt(),
  unitName: json['unitName'] as String?,
  listPriceHt: const NullableDecimalConverter().fromJson(
    json['listPriceHt'] as String?,
  ),
  isFree: json['isFree'] as bool? ?? false,
  promotion: _promo(json['promotion']),
  freeOfPosition: (json['freeOfPosition'] as num?)?.toInt(),
);
