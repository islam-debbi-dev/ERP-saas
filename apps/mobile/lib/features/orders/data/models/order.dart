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
    this.assujettiTva = true,
    this.livreur,
    this.deliveryVehicle,
    this.sale,
    this.lines = const [],
  });

  final String id;
  final String? number;
  final String status;
  final OrderClient client;

  /// Who delivers it, and the delivery truck it was put on (phase 36).
  @JsonKey(fromJson: _userRef)
  final UserRef? livreur;
  @JsonKey(fromJson: _vehicleRef)
  final VehicleRef? deliveryVehicle;

  /// The BL of the delivery, once delivered.
  @JsonKey(fromJson: _docRef)
  final DocRef? sale;

  /// The tenant's TVA regime when the order was priced.
  final bool assujettiTva;
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
  bool get isConfirmed => status == 'CONFIRMED';

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
    required this.factorToBase,
    required this.tvaRate,
    this.isFree = false,
    this.freeOfPosition,
    this.promotion,
    this.availableBase,
    this.qtyDelivered,
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

  /// A free line (UG) goes with the paid line at this position.
  final int? freeOfPosition;
  @JsonKey(fromJson: _promotionName)
  final String? promotion;

  /// Pieces in one unit of the line (`CRT` = 24).
  @DecimalConverter()
  final Decimal factorToBase;
  @DecimalConverter()
  final Decimal tvaRate;

  /// Stock now in the dépôt or truck that delivers it (base unit), for
  /// information: the server decides with the tenant's negative-stock rule.
  @NullableDecimalConverter()
  final Decimal? availableBase;
  @NullableDecimalConverter()
  final Decimal? qtyDelivered;

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
    this.shortLines = 0,
    this.deliveryVehicle,
  });

  final String id;
  final String? number;
  final String status;
  final OrderClient client;
  final String? requestedDate;
  @DecimalConverter()
  final Decimal totalTtc;
  final int lineCount;

  /// Lines whose ordered quantity is above the delivering stock right now.
  final int shortLines;
  @JsonKey(fromJson: _vehicleRef)
  final VehicleRef? deliveryVehicle;
  final DateTime createdAt;

  factory OrderSummary.fromJson(Map<String, dynamic> json) =>
      _$OrderSummaryFromJson(json);
}

/// `{ id, number }` of a linked document (the BL of a delivered order).
class DocRef {
  const DocRef({required this.id, this.number});

  final String id;
  final String? number;

  factory DocRef.fromJson(Map<String, dynamic> json) =>
      DocRef(id: json['id'] as String, number: json['number'] as String?);
}

UserRef? _userRef(Object? json) =>
    json == null ? null : UserRef.fromJson(json as Map<String, dynamic>);

VehicleRef? _vehicleRef(Object? json) =>
    json == null ? null : VehicleRef.fromJson(json as Map<String, dynamic>);

DocRef? _docRef(Object? json) =>
    json == null ? null : DocRef.fromJson(json as Map<String, dynamic>);

String? _promotionName(Object? json) =>
    json == null ? null : (json as Map<String, dynamic>)['name'] as String?;
