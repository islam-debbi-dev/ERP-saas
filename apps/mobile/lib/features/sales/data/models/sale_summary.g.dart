// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaleSummary _$SaleSummaryFromJson(Map<String, dynamic> json) => SaleSummary(
  id: json['id'] as String,
  type: json['type'] as String,
  status: json['status'] as String,
  documentDate: json['documentDate'] as String,
  totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
  paidAmount: const DecimalConverter().fromJson(json['paidAmount'] as String),
  number: json['number'] as String?,
  client: json['client'] == null
      ? null
      : SaleClientRef.fromJson(json['client'] as Map<String, dynamic>),
  lineCount: (json['lineCount'] as num?)?.toInt() ?? 0,
);

SaleClientRef _$SaleClientRefFromJson(Map<String, dynamic> json) =>
    SaleClientRef(
      id: json['id'] as String,
      name: json['name'] as String,
      code: json['code'] as String?,
    );
