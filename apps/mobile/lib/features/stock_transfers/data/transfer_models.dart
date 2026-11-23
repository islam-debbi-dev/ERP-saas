import 'package:decimal/decimal.dart';

import '../../../core/models/json_converters.dart';
import '../../../core/models/product_unit.dart';

/// Kinds of `StockTransferType` the phone works with: chargement (dépôt →
/// truck) and déchargement (truck → dépôt). Plain dépôt → dépôt transfers
/// stay on the web.
class TransferType {
  TransferType._();

  static const load = 'LOAD';
  static const unload = 'UNLOAD';
  static const transfer = 'TRANSFER';

  static const onPhone = {load, unload};
}

/// `StockTransferStatus`.
class TransferStatus {
  TransferStatus._();

  static const draft = 'DRAFT';
  static const validated = 'VALIDATED';
  static const cancelled = 'CANCELLED';
}

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

/// One line of `StockTransferDto`: the quantity as entered and in the base
/// unit. Quantities only: a transfer carries no price and no cost.
class TransferLineDto {
  const TransferLineDto({
    required this.productId,
    required this.reference,
    required this.designation,
    required this.unitId,
    required this.unitCode,
    required this.qty,
    required this.qtyBase,
  });

  final String productId;
  final String reference;
  final String designation;
  final String unitId;
  final String unitCode;
  final Decimal qty;
  final Decimal qtyBase;

  factory TransferLineDto.fromJson(Map<String, dynamic> json) =>
      TransferLineDto(
        productId: json['productId'] as String,
        reference: json['reference'] as String? ?? '',
        designation: json['designation'] as String,
        unitId: json['unitId'] as String,
        unitCode: json['unitCode'] as String,
        qty: Decimal.parse(json['qty'] as String),
        qtyBase: Decimal.parse(json['qtyBase'] as String),
      );
}

/// `{ id, name, type }` of either side of a transfer.
class TransferPlace {
  const TransferPlace({required this.id, required this.name, this.type});

  final String id;
  final String name;

  /// MAIN, SECONDARY or VEHICLE; absent in the list rows.
  final String? type;

  bool get isTruck => type == 'VEHICLE';

  factory TransferPlace.fromJson(Map<String, dynamic> json) => TransferPlace(
    id: json['id'] as String,
    name: json['name'] as String,
    type: json['type'] as String?,
  );
}

/// `StockTransferDto` (`packages/shared/src/schemas/warehouses.ts`).
class StockTransfer {
  const StockTransfer({
    required this.id,
    required this.type,
    required this.status,
    required this.from,
    required this.to,
    required this.createdAt,
    this.number,
    this.note,
    this.cancelReason,
    this.createdBy,
    this.validatedAt,
    this.cancelledAt,
    this.lines = const [],
  });

  final String id;

  /// `TR-YYYY-000001` once validated; null on a draft.
  final String? number;
  final String type;
  final String status;
  final TransferPlace from;
  final TransferPlace to;
  final String? note;
  final String? cancelReason;
  final UserRef? createdBy;
  final DateTime createdAt;
  final DateTime? validatedAt;
  final DateTime? cancelledAt;
  final List<TransferLineDto> lines;

  bool get isDraft => status == TransferStatus.draft;
  bool get isValidated => status == TransferStatus.validated;
  bool get isCancelled => status == TransferStatus.cancelled;
  bool get isLoad => type == TransferType.load;

  /// The truck side of a chargement / déchargement.
  TransferPlace get truck => isLoad ? to : from;

  factory StockTransfer.fromJson(Map<String, dynamic> json) => StockTransfer(
    id: json['id'] as String,
    number: json['number'] as String?,
    type: json['type'] as String,
    status: json['status'] as String,
    from: TransferPlace.fromJson(json['from'] as Map<String, dynamic>),
    to: TransferPlace.fromJson(json['to'] as Map<String, dynamic>),
    note: json['note'] as String?,
    cancelReason: json['cancelReason'] as String?,
    createdBy: json['createdBy'] == null
        ? null
        : UserRef.fromJson(json['createdBy'] as Map<String, dynamic>),
    createdAt: DateTime.parse(json['createdAt'] as String),
    validatedAt: _date(json['validatedAt']),
    cancelledAt: _date(json['cancelledAt']),
    lines: [
      for (final l in json['lines'] as List<dynamic>? ?? const [])
        TransferLineDto.fromJson(l as Map<String, dynamic>),
    ],
  );
}

/// A row of `GET /stock-transfers` (`StockTransferSummaryDto`).
class TransferSummary {
  const TransferSummary({
    required this.id,
    required this.type,
    required this.status,
    required this.from,
    required this.to,
    required this.lineCount,
    required this.createdAt,
    this.number,
    this.validatedAt,
  });

  final String id;
  final String? number;
  final String type;
  final String status;
  final TransferPlace from;
  final TransferPlace to;
  final int lineCount;
  final DateTime createdAt;
  final DateTime? validatedAt;

  bool get isDraft => status == TransferStatus.draft;
  bool get isCancelled => status == TransferStatus.cancelled;
  bool get isLoad => type == TransferType.load;

  /// The truck side (the destination of a chargement, the source of a
  /// déchargement).
  TransferPlace get truck => isLoad ? to : from;

  factory TransferSummary.fromJson(Map<String, dynamic> json) =>
      TransferSummary(
        id: json['id'] as String,
        number: json['number'] as String?,
        type: json['type'] as String,
        status: json['status'] as String,
        from: TransferPlace.fromJson(json['from'] as Map<String, dynamic>),
        to: TransferPlace.fromJson(json['to'] as Map<String, dynamic>),
        lineCount: json['lineCount'] as int? ?? 0,
        createdAt: DateTime.parse(json['createdAt'] as String),
        validatedAt: _date(json['validatedAt']),
      );
}

/// A dépôt the user may count or load from (`WarehouseDto`, MAIN or
/// SECONDARY).
class DepotOption {
  const DepotOption({
    required this.id,
    required this.name,
    this.code,
    this.isDefault = false,
  });

  final String id;
  final String name;
  final String? code;
  final bool isDefault;

  String get label => code == null || code!.isEmpty ? name : '$code · $name';

  /// Live dépôts (not trucks) from `GET /warehouses`, the default one first.
  static List<DepotOption> listFrom(Object? json) {
    final out = [
      for (final w in json! as List<dynamic>)
        if ((w as Map<String, dynamic>)['active'] != false &&
            w['type'] != 'VEHICLE')
          DepotOption(
            id: w['id'] as String,
            name: w['name'] as String,
            code: w['code'] as String?,
            isDefault: w['isDefault'] as bool? ?? false,
          ),
    ];
    out.sort((a, b) => a.isDefault == b.isDefault ? 0 : (a.isDefault ? -1 : 1));
    return out;
  }
}

/// A product's stock in one dépôt (`StockLevelDto`), quantities only.
///
/// `avgCost` and `value` are **not read**: the storekeeper's screens never
/// show a cost or a value, even for a user who may see them on the web.
class StockLevel {
  const StockLevel({
    required this.productId,
    required this.reference,
    required this.designation,
    required this.qtyBase,
    required this.baseUnit,
    this.packaging,
  });

  final String productId;
  final String reference;
  final String designation;
  final Decimal qtyBase;

  /// The base unit (factor 1).
  final ProductUnit baseUnit;

  /// The largest packaging unit (carton...), if any.
  final ProductUnit? packaging;

  /// Base unit first, then the packaging.
  List<ProductUnit> get units => [baseUnit, ?packaging];

  factory StockLevel.fromJson(Map<String, dynamic> json) {
    final base = json['baseUnit'] as Map<String, dynamic>? ?? const {};
    final pack = json['packaging'] as Map<String, dynamic>?;
    final baseUnitId = json['baseUnitId'] as String;
    return StockLevel(
      productId: json['productId'] as String,
      reference: json['reference'] as String? ?? '',
      designation: json['designation'] as String,
      qtyBase: Decimal.parse(json['qtyBase'] as String),
      baseUnit: ProductUnit(
        id: baseUnitId,
        unitId: baseUnitId,
        unitCode: base['unitCode'] as String? ?? '',
        unitName: base['unitName'] as String?,
        allowsDecimal: base['allowsDecimal'] as bool? ?? false,
        factorToBase: Decimal.one,
      ),
      packaging: pack == null
          ? null
          : ProductUnit(
              id: pack['unitId'] as String,
              unitId: pack['unitId'] as String,
              unitCode: pack['unitCode'] as String,
              unitName: pack['unitName'] as String?,
              factorToBase: Decimal.parse(pack['factorToBase'] as String),
            ),
    );
  }
}

/// What validate / cancel answer (`StockTransferResultDto`): the transfer
/// and, in WARN mode, the products a dépôt went negative on.
class TransferResult {
  const TransferResult({required this.transfer, this.warnings = const []});

  final StockTransfer transfer;
  final List<StockShortage> warnings;

  factory TransferResult.fromJson(Map<String, dynamic> json) => TransferResult(
    transfer: StockTransfer.fromJson(json['transfer'] as Map<String, dynamic>),
    warnings: [
      for (final w in json['warnings'] as List<dynamic>? ?? const [])
        StockShortage.fromJson(w as Map<String, dynamic>),
    ],
  );
}

/// `StockWarning`: a dépôt left below zero (base unit).
class StockShortage {
  const StockShortage({
    required this.productId,
    required this.available,
    required this.after,
  });

  final String productId;
  final Decimal available;
  final Decimal after;

  factory StockShortage.fromJson(Map<String, dynamic> json) => StockShortage(
    productId: json['productId'] as String,
    available: Decimal.parse(json['available'] as String),
    after: Decimal.parse(json['after'] as String),
  );
}
