import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'sale_summary.g.dart';

/// A row of `GET /sales` (`SaleSummaryDto`).
@JsonSerializable(createToJson: false)
class SaleSummary {
  const SaleSummary({
    required this.id,
    required this.type,
    required this.status,
    required this.documentDate,
    required this.totalTtc,
    required this.paidAmount,
    this.number,
    this.client,
    this.lineCount = 0,
  });

  final String id;
  final String type;
  final String? number;
  final String status;
  final SaleClientRef? client;
  final String documentDate;
  @DecimalConverter()
  final Decimal totalTtc;
  @DecimalConverter()
  final Decimal paidAmount;
  final int lineCount;

  factory SaleSummary.fromJson(Map<String, dynamic> json) =>
      _$SaleSummaryFromJson(json);
}

@JsonSerializable(createToJson: false)
class SaleClientRef {
  const SaleClientRef({required this.id, required this.name, this.code});

  final String id;
  final String? code;
  final String name;

  factory SaleClientRef.fromJson(Map<String, dynamic> json) =>
      _$SaleClientRefFromJson(json);
}
