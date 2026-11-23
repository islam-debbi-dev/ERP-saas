import 'package:decimal/decimal.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';

/// `InventoryStatus`.
class InventoryStatus {
  InventoryStatus._();

  static const open = 'OPEN';
  static const validated = 'VALIDATED';
  static const cancelled = 'CANCELLED';
}

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

/// A row of `GET /inventories` (`InventorySummaryDto`).
class InventorySummary {
  const InventorySummary({
    required this.id,
    required this.number,
    required this.status,
    required this.lineCount,
    required this.createdAt,
    this.warehouseId,
    this.validatedAt,
  });

  final String id;
  final String number;
  final String status;
  final String? warehouseId;
  final int lineCount;
  final DateTime createdAt;
  final DateTime? validatedAt;

  bool get isOpen => status == InventoryStatus.open;

  factory InventorySummary.fromJson(Map<String, dynamic> json) =>
      InventorySummary(
        id: json['id'] as String,
        number: json['number'] as String,
        status: json['status'] as String,
        warehouseId: json['warehouseId'] as String?,
        lineCount: json['lineCount'] as int? ?? 0,
        createdAt: DateTime.parse(json['createdAt'] as String),
        validatedAt: _date(json['validatedAt']),
      );
}

/// A counted product (`InventoryLineDto`), base unit. "Expected" is the
/// dépôt's live stock while open, frozen at validation.
class InventoryLine {
  const InventoryLine({
    required this.productId,
    required this.reference,
    required this.designation,
    required this.countedQtyBase,
    required this.expectedQtyBase,
    required this.diffQtyBase,
  });

  final String productId;
  final String reference;
  final String designation;
  final Decimal countedQtyBase;

  /// Null without STOCK_ADJUST: the API keeps the count blind.
  final Decimal? expectedQtyBase;
  final Decimal? diffQtyBase;

  factory InventoryLine.fromJson(Map<String, dynamic> json) => InventoryLine(
    productId: json['productId'] as String,
    reference: json['reference'] as String? ?? '',
    designation: json['designation'] as String,
    countedQtyBase: Decimal.parse(json['countedQtyBase'] as String),
    expectedQtyBase: _qtyOrNull(json['expectedQtyBase']),
    diffQtyBase: _qtyOrNull(json['diffQtyBase']),
  );
}

/// `InventoryDto`.
class Inventory {
  const Inventory({
    required this.id,
    required this.number,
    required this.status,
    required this.createdAt,
    this.warehouseId,
    this.note,
    this.validatedAt,
    this.cancelledAt,
    this.lines = const [],
  });

  final String id;
  final String number;
  final String status;
  final String? warehouseId;
  final String? note;
  final DateTime createdAt;
  final DateTime? validatedAt;
  final DateTime? cancelledAt;
  final List<InventoryLine> lines;

  bool get isOpen => status == InventoryStatus.open;

  factory Inventory.fromJson(Map<String, dynamic> json) => Inventory(
    id: json['id'] as String,
    number: json['number'] as String,
    status: json['status'] as String,
    warehouseId: json['warehouseId'] as String?,
    note: json['note'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
    validatedAt: _date(json['validatedAt']),
    cancelledAt: _date(json['cancelledAt']),
    lines: [
      for (final l in json['lines'] as List<dynamic>? ?? const [])
        InventoryLine.fromJson(l as Map<String, dynamic>),
    ],
  );
}

/// Inventaires (`/inventories`): counting needs STOCK_COUNT, validating
/// STOCK_ADJUST (the API checks both).
class InventoriesRepository {
  InventoriesRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<List<InventorySummary>>> list() => _api.get(
    '/inventories',
    decode: (json) => [
      for (final r in json! as List<dynamic>)
        InventorySummary.fromJson(r as Map<String, dynamic>),
    ],
  );

  Future<ApiResult<Inventory>> get(String id) => _api.get(
    '/inventories/$id',
    decode: (json) => Inventory.fromJson(json.asMap),
  );

  /// Opens a count on [warehouseId] (numbered `INV-…` at once).
  Future<ApiResult<Inventory>> create(
    String warehouseId, {
    required IdempotencyKey key,
  }) => _api.post(
    '/inventories',
    data: {'warehouseId': warehouseId},
    idempotencyKey: key,
    decode: (json) => Inventory.fromJson(json.asMap),
  );

  /// Upserts counted lines (`{productId, unitId, qty}`, `qty: null`
  /// removes one). Setting the same counts twice changes nothing.
  Future<ApiResult<Inventory>> setLines(
    String id,
    List<Map<String, dynamic>> lines,
  ) => _api.put(
    '/inventories/$id/lines',
    data: {'lines': lines},
    decode: (json) => Inventory.fromJson(json.asMap),
  );

  /// Writes the adjustments (STOCK_ADJUST).
  Future<ApiResult<Inventory>> validate(
    String id, {
    required IdempotencyKey key,
  }) => _api.post(
    '/inventories/$id/validate',
    idempotencyKey: key,
    decode: (json) => Inventory.fromJson(json.asMap),
  );
}

Decimal? _qtyOrNull(Object? v) => v == null ? null : Decimal.parse(v as String);
