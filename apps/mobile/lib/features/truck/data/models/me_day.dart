import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'me_day.g.dart';

/// `GET /me/day` (`MeDayDto` in `packages/shared/src/schemas/tournees.ts`):
/// the user's truck, session, expected cash, truck stock and today's
/// chargements / déchargements. Quantities only, never a cost.
@JsonSerializable(createToJson: false)
class MeDay {
  const MeDay({
    required this.day,
    required this.expected,
    this.vehicle,
    this.session,
    this.stock = const [],
    this.transfers = const [],
  });

  final String day;
  @JsonKey(fromJson: _vehicle)
  final VehicleRef? vehicle;
  final DaySession? session;
  final ExpectedCash expected;
  final List<TruckStockLine> stock;
  final List<DayTransfer> transfers;

  factory MeDay.fromJson(Map<String, dynamic> json) => _$MeDayFromJson(json);
}

VehicleRef? _vehicle(Object? json) =>
    json == null ? null : VehicleRef.fromJson(json as Map<String, dynamic>);

@JsonSerializable(createToJson: false)
class ExpectedCash {
  const ExpectedCash({
    required this.fromSales,
    required this.fromVersements,
    required this.total,
  });

  @DecimalConverter()
  final Decimal fromSales;
  @DecimalConverter()
  final Decimal fromVersements;
  @DecimalConverter()
  final Decimal total;

  factory ExpectedCash.fromJson(Map<String, dynamic> json) =>
      _$ExpectedCashFromJson(json);
}

/// The user's session of today (`SellerSessionDto`, the fields shown).
@JsonSerializable(createToJson: false)
class DaySession {
  const DaySession({
    required this.id,
    required this.status,
    this.handedCash,
    this.ecart,
    this.closedAt,
  });

  final String id;

  /// OPEN or CLOSED.
  final String status;
  @NullableDecimalConverter()
  final Decimal? handedCash;
  @NullableDecimalConverter()
  final Decimal? ecart;
  final DateTime? closedAt;

  bool get isOpen => status == 'OPEN';

  factory DaySession.fromJson(Map<String, dynamic> json) =>
      _$DaySessionFromJson(json);
}

/// `VehicleStockLineDto`: what is on the truck, in the base unit.
@JsonSerializable(createToJson: false)
class TruckStockLine {
  const TruckStockLine({
    required this.productId,
    required this.reference,
    required this.designation,
    required this.unitCode,
    required this.qtyBase,
  });

  final String productId;
  final String reference;
  final String designation;
  final String unitCode;
  @DecimalConverter()
  final Decimal qtyBase;

  factory TruckStockLine.fromJson(Map<String, dynamic> json) =>
      _$TruckStockLineFromJson(json);
}

/// `MeDayTransferDto`: a validated chargement (LOAD) or déchargement (UNLOAD).
@JsonSerializable(createToJson: false)
class DayTransfer {
  const DayTransfer({
    required this.id,
    required this.type,
    required this.validatedAt,
    required this.from,
    required this.to,
    this.number,
    this.lines = const [],
  });

  final String id;
  final String? number;
  final String type;
  final DateTime validatedAt;
  @JsonKey(fromJson: _named)
  final NamedRef from;
  @JsonKey(fromJson: _named)
  final NamedRef to;
  final List<TransferLine> lines;

  bool get isLoad => type == 'LOAD';

  factory DayTransfer.fromJson(Map<String, dynamic> json) =>
      _$DayTransferFromJson(json);
}

NamedRef _named(Object? json) =>
    NamedRef.fromJson(json as Map<String, dynamic>);

@JsonSerializable(createToJson: false)
class TransferLine {
  const TransferLine({
    required this.productId,
    required this.designation,
    required this.unitCode,
    required this.qty,
    required this.qtyBase,
  });

  final String productId;
  final String designation;
  final String unitCode;
  @DecimalConverter()
  final Decimal qty;
  @DecimalConverter()
  final Decimal qtyBase;

  factory TransferLine.fromJson(Map<String, dynamic> json) =>
      _$TransferLineFromJson(json);
}
