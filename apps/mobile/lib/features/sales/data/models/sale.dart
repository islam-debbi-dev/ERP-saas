import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';
import 'sale_summary.dart';

part 'sale.g.dart';

/// A sale document as the API saved it (`SaleDto`, the fields the phone
/// shows). After a save the app shows this, never its own preview.
@JsonSerializable(createToJson: false)
class Sale {
  const Sale({
    required this.id,
    required this.type,
    required this.status,
    required this.documentDate,
    required this.totalHt,
    required this.totalTva,
    required this.totalTtc,
    required this.timbre,
    required this.paidAmount,
    this.number,
    this.client,
    this.paymentMode,
    this.lines = const [],
    this.validatedAt,
  });

  final String id;
  final String type;
  final String? number;
  final String status;
  final SaleClientRef? client;
  final String documentDate;
  @DecimalConverter()
  final Decimal totalHt;
  @DecimalConverter()
  final Decimal totalTva;
  @DecimalConverter()
  final Decimal totalTtc;
  @DecimalConverter()
  final Decimal timbre;
  @DecimalConverter()
  final Decimal paidAmount;
  final String? paymentMode;
  final List<SaleLine> lines;
  final DateTime? validatedAt;

  /// What stays on the client's account from this document.
  Decimal get remaining {
    final r = totalTtc - paidAmount;
    return r < Decimal.zero ? Decimal.zero : r;
  }

  factory Sale.fromJson(Map<String, dynamic> json) => _$SaleFromJson(json);
}

@JsonSerializable(createToJson: false)
class SaleLine {
  const SaleLine({
    required this.id,
    required this.position,
    required this.productId,
    required this.designation,
    required this.unitCode,
    required this.qty,
    required this.unitPriceHt,
    required this.discountPct,
    required this.lineHt,
    this.unitName,
    this.isFree = false,
  });

  final String id;
  final int position;
  final String productId;
  final String designation;
  final String unitCode;
  final String? unitName;
  @DecimalConverter()
  final Decimal qty;
  @DecimalConverter()
  final Decimal unitPriceHt;
  @DecimalConverter()
  final Decimal discountPct;
  @DecimalConverter()
  final Decimal lineHt;
  final bool isFree;

  String get unitLabel => unitName ?? unitCode;

  factory SaleLine.fromJson(Map<String, dynamic> json) =>
      _$SaleLineFromJson(json);
}

/// `SaleResultDto`: the saved sale, its warnings, the change given back and
/// the GPS check of the validation.
class SaleResult {
  const SaleResult({
    required this.sale,
    required this.change,
    this.warnings = const [],
    this.geoStatus,
  });

  final Sale sale;
  final Decimal change;

  /// Raw warnings (`kind`: STOCK_NEGATIVE, CREDIT_LIMIT...), shown as notes.
  final List<Map<String, dynamic>> warnings;

  /// OK / FAR / NO_SIGNAL / ... when the position was checked.
  final String? geoStatus;

  factory SaleResult.fromJson(Map<String, dynamic> json) => SaleResult(
    sale: Sale.fromJson(json['sale'] as Map<String, dynamic>),
    change: Decimal.parse(json['change'] as String? ?? '0'),
    warnings: [
      for (final w in json['warnings'] as List<dynamic>? ?? const [])
        w as Map<String, dynamic>,
    ],
    geoStatus:
        (json['geoCheck'] as Map<String, dynamic>?)?['status'] as String?,
  );
}
