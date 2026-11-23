import 'dart:convert';

import 'package:decimal/decimal.dart';

import '../../../core/helpers/money.dart';
import '../../../core/models/product_unit.dart';
import '../../catalog/data/models/product.dart';
import '../data/transfer_models.dart';

/// One line of a chargement / déchargement being prepared: a product, the
/// unit it is counted in (cartons, pièces...) and the quantity in that unit.
class TransferLineDraft {
  const TransferLineDraft({
    required this.product,
    required this.unit,
    required this.qty,
  });

  final Product product;
  final ProductUnit unit;
  final Decimal qty;

  String get productId => product.id;

  /// The quantity in the product's base unit (what the stock moves by).
  Decimal get qtyBase => unit.toBase(qty);

  TransferLineDraft copyWith({ProductUnit? unit, Decimal? qty}) =>
      TransferLineDraft(
        product: product,
        unit: unit ?? this.unit,
        qty: qty ?? this.qty,
      );
}

/// Why a line cannot be sent.
enum LineIssue { notPositive, notWhole }

/// A chargement (dépôt → camion) or a déchargement (camion → dépôt) being
/// prepared on the phone. Pure Dart: the screen and the cubit only call it.
/// The API checks everything again (types, dépôts, stock, duplicates).
class TransferForm {
  const TransferForm({
    required this.type,
    this.truckId,
    this.depotId,
    this.lines = const [],
    this.note = '',
  });

  /// [TransferType.load] or [TransferType.unload].
  final String type;
  final String? truckId;
  final String? depotId;
  final List<TransferLineDraft> lines;
  final String note;

  /// The API's limit (`createStockTransferSchema`).
  static const maxLines = 300;

  bool get isLoad => type == TransferType.load;

  /// Where the goods leave from: the dépôt for a chargement, the truck for
  /// a déchargement.
  String? get fromId => isLoad ? depotId : truckId;
  String? get toId => isLoad ? truckId : depotId;

  bool get isEmpty => lines.isEmpty;

  TransferForm copyWith({
    String? truckId,
    String? depotId,
    List<TransferLineDraft>? lines,
    String? note,
  }) => TransferForm(
    type: type,
    truckId: truckId ?? this.truckId,
    depotId: depotId ?? this.depotId,
    lines: lines ?? this.lines,
    note: note ?? this.note,
  );

  TransferLineDraft? lineOf(String productId) {
    for (final l in lines) {
      if (l.productId == productId) return l;
    }
    return null;
  }

  /// Adds [qty] of [unit]. A product is on one line only: the same unit adds
  /// up; another unit turns the line into the base unit with the sum, so
  /// nothing is rounded away (2 CRT + 3 PCE = 15 PCE when a carton is 6).
  TransferForm add(Product product, ProductUnit unit, Decimal qty) {
    final existing = lineOf(product.id);
    if (existing == null) {
      return copyWith(
        lines: [
          ...lines,
          TransferLineDraft(product: product, unit: unit, qty: qty),
        ],
      );
    }
    final TransferLineDraft merged;
    if (existing.unit.unitId == unit.unitId) {
      merged = existing.copyWith(qty: existing.qty + qty);
    } else {
      // The picked product carries every unit (a saved line may know only
      // its own), so the line takes it.
      final total = existing.qtyBase + unit.toBase(qty);
      final base = product.baseUnit;
      merged = base == null
          ? TransferLineDraft(
              product: product,
              unit: unit,
              qty: unit.fromBase(total),
            )
          : TransferLineDraft(product: product, unit: base, qty: total);
    }
    return _replace(merged);
  }

  /// Sets a line's unit and quantity (the edit sheet).
  TransferForm set(String productId, ProductUnit unit, Decimal qty) {
    final l = lineOf(productId);
    return l == null ? this : _replace(l.copyWith(unit: unit, qty: qty));
  }

  /// ±1 in the line's unit, never below zero.
  TransferForm step(String productId, int by) {
    final l = lineOf(productId);
    if (l == null) return this;
    final next = l.qty + Decimal.fromInt(by);
    return _replace(l.copyWith(qty: next < Decimal.zero ? Decimal.zero : next));
  }

  TransferForm remove(String productId) =>
      copyWith(lines: [...lines.where((l) => l.productId != productId)]);

  TransferForm _replace(TransferLineDraft line) => copyWith(
    lines: [for (final l in lines) l.productId == line.productId ? line : l],
  );

  /// What is wrong with [line], if anything.
  static LineIssue? issueOf(TransferLineDraft line) {
    if (line.qty <= Decimal.zero) return LineIssue.notPositive;
    if (!line.unit.allowsDecimal && !line.qty.isInteger) {
      return LineIssue.notWhole;
    }
    return null;
  }

  /// Form-level problems (string keys); lines are checked by [issueOf].
  List<String> errors({bool forValidation = false}) => [
    if (truckId == null) 'transfer.error_truck',
    if (depotId == null) 'transfer.error_depot',
    if (lines.length > maxLines) 'transfer.error_too_many',
    if (forValidation && lines.isEmpty) 'transfer.error_no_lines',
    if (lines.any((l) => issueOf(l) != null)) 'transfer.error_lines',
  ];

  bool canSave({bool forValidation = false}) =>
      errors(forValidation: forValidation).isEmpty;

  /// The quantities to confirm, per unit as entered (`120 CRT`, `30 PCE`):
  /// units are never added together.
  Map<String, Decimal> totalsByUnit() {
    final out = <String, Decimal>{};
    for (final l in lines) {
      out[l.unit.unitCode] = (out[l.unit.unitCode] ?? Decimal.zero) + l.qty;
    }
    return out;
  }

  /// `createStockTransferSchema` / `updateStockTransferSchema` body.
  Map<String, dynamic> toBody() => {
    'type': type,
    'fromWarehouseId': fromId,
    'toWarehouseId': toId,
    if (note.trim().isNotEmpty) 'note': note.trim(),
    'lines': [
      for (final l in lines)
        {
          'productId': l.productId,
          'unitId': l.unit.unitId,
          'qty': Qty.toApi(l.qty),
        },
    ],
  };

  /// A stable text of [toBody], to tell whether the draft changed.
  String get signature => jsonEncode(toBody());

  /// A saved draft back into a form. [products] gives the units of a
  /// product (from the source's stock); without it the line keeps only its
  /// own unit, with the factor the API used.
  factory TransferForm.fromTransfer(
    StockTransfer t, {
    Map<String, Product> products = const {},
  }) {
    final isLoad = t.type == TransferType.load;
    return TransferForm(
      type: t.type,
      truckId: isLoad ? t.to.id : t.from.id,
      depotId: isLoad ? t.from.id : t.to.id,
      note: t.note ?? '',
      lines: [for (final l in t.lines) _lineFrom(l, products[l.productId])],
    );
  }

  static TransferLineDraft _lineFrom(TransferLineDto l, Product? known) {
    final unit = known?.unitById(l.unitId);
    if (known != null && unit != null) {
      return TransferLineDraft(product: known, unit: unit, qty: l.qty);
    }
    final factor = l.qty > Decimal.zero
        ? (l.qtyBase / l.qty).toDecimal(scaleOnInfinitePrecision: 3)
        : Decimal.one;
    final own = ProductUnit(
      id: l.unitId,
      unitId: l.unitId,
      unitCode: l.unitCode,
      factorToBase: factor,
    );
    return TransferLineDraft(
      product: Product(
        id: l.productId,
        reference: l.reference,
        designation: l.designation,
        baseUnitId: factor == Decimal.one ? l.unitId : '',
        tvaRate: Decimal.zero,
        units: [own],
      ),
      unit: own,
      qty: l.qty,
    );
  }

  /// The evening déchargement: everything left on the truck, in its
  /// packaging when the quantity is a whole number of it, else in the base
  /// unit. The user then edits it.
  factory TransferForm.unloadRest({
    required String truckId,
    required String? depotId,
    required List<StockLevel> truckStock,
  }) => TransferForm(
    type: TransferType.unload,
    truckId: truckId,
    depotId: depotId,
    lines: [
      for (final s in truckStock)
        if (s.qtyBase > Decimal.zero) _restLine(s),
    ],
  );

  static TransferLineDraft _restLine(StockLevel s) {
    final product = productOf(s);
    final pack = s.packaging;
    if (pack != null) {
      final inPacks = pack.fromBase(s.qtyBase);
      if (inPacks.isInteger && pack.toBase(inPacks) == s.qtyBase) {
        return TransferLineDraft(product: product, unit: pack, qty: inPacks);
      }
    }
    return TransferLineDraft(
      product: product,
      unit: s.baseUnit,
      qty: s.qtyBase,
    );
  }
}

/// A dépôt's stock row as a [Product] (units only, no price), so the
/// picker's sheet and the form work on it.
Product productOf(StockLevel s) => Product(
  id: s.productId,
  reference: s.reference,
  designation: s.designation,
  baseUnitId: s.baseUnit.unitId,
  tvaRate: Decimal.zero,
  units: s.units,
);
