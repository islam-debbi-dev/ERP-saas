import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'order.g.dart';

/// A bon de commande (`OrderDto` in `packages/shared/src/schemas/tournees.ts`).
@JsonSerializable(createToJson: false)
class Order {
  const Order({
    required this.id,
    required this.status,
    required this.client,
    required this.totalHt,
    required this.totalTva,
    required this.totalTtc,
    required this.createdAt,
    required this.version,
    this.number,
    this.requestedDate,
    this.note,
    this.cancelReason,
    this.lines = const [],
  });

  final String id;
  final String? number;
  final String status;
  final OrderClient client;
  final String? requestedDate;
  final String? note;
  @DecimalConverter()
  final Decimal totalHt;
  @DecimalConverter()
  final Decimal totalTva;
  @DecimalConverter()
  final Decimal totalTtc;
  final String? cancelReason;
  final DateTime createdAt;
  final int version;
  final List<OrderLine> lines;

  bool get isDraft => status == 'DRAFT';

  factory Order.fromJson(Map<String, dynamic> json) => _$OrderFromJson(json);
}

@JsonSerializable(createToJson: false)
class OrderClient {
  const OrderClient({
    required this.id,
    required this.code,
    required this.name,
    this.phone,
  });

  final String id;
  final String code;
  final String name;
  final String? phone;

  factory OrderClient.fromJson(Map<String, dynamic> json) =>
      _$OrderClientFromJson(json);
}

@JsonSerializable(createToJson: false)
class OrderLine {
  const OrderLine({
    required this.id,
    required this.position,
    required this.productId,
    required this.designation,
    required this.unitCode,
    required this.qty,
    required this.unitPriceHt,
    required this.discountPct,
    required this.lineHt,
    this.isFree = false,
  });

  final String id;
  final int position;
  final String productId;
  final String designation;
  final String unitCode;
  @DecimalConverter()
  final Decimal qty;
  @DecimalConverter()
  final Decimal unitPriceHt;
  @DecimalConverter()
  final Decimal discountPct;
  @DecimalConverter()
  final Decimal lineHt;
  final bool isFree;

  factory OrderLine.fromJson(Map<String, dynamic> json) =>
      _$OrderLineFromJson(json);
}

/// A row of `GET /orders` (`OrderSummaryDto`).
@JsonSerializable(createToJson: false)
class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.status,
    required this.client,
    required this.totalTtc,
    required this.createdAt,
    this.number,
    this.requestedDate,
    this.lineCount = 0,
  });

  final String id;
  final String? number;
  final String status;
  final OrderClient client;
  final String? requestedDate;
  @DecimalConverter()
  final Decimal totalTtc;
  final int lineCount;
  final DateTime createdAt;

  factory OrderSummary.fromJson(Map<String, dynamic> json) =>
      _$OrderSummaryFromJson(json);
}
