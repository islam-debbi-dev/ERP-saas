import 'package:decimal/decimal.dart';

import '../../../core/helpers/money.dart';
import '../../orders/data/models/order.dart';
import '../../sales/logic/basket.dart';

/// Preview totals of what is delivered.
class DeliveryTotals {
  const DeliveryTotals({
    required this.totalHt,
    required this.totalTva,
    required this.totalTtc,
  });

  final Decimal totalHt;
  final Decimal totalTva;
  final Decimal totalTtc;
}

/// The delivered quantities of one order, in plain Dart (unit-tested).
///
/// Each paid line starts at its ordered quantity; 0 is allowed (rupture) and
/// nothing above the ordered quantity. Free units (UG) are not typed: they go
/// with their paid line in proportion, as the API's `proportionalFree` does
/// (the API recomputes them anyway). Prices are the order's frozen ones: the
/// livreur never edits a price. Totals are a preview; the BL the API makes is
/// the truth.
class DeliveryForm {
  DeliveryForm(this.order, [Map<String, Decimal>? qty])
    : _qty =
          qty ??
          {
            for (final l in order.lines)
              if (!l.isFree) l.id: l.qty,
          };

  final Order order;
  final Map<String, Decimal> _qty;

  List<OrderLine> get paidLines =>
      order.lines.where((l) => !l.isFree).toList(growable: false);

  List<OrderLine> freeLinesOf(OrderLine paid) => order.lines
      .where((l) => l.isFree && l.freeOfPosition == paid.position)
      .toList(growable: false);

  /// What is handed over on [line] (a paid line).
  Decimal qtyOf(OrderLine line) => _qty[line.id] ?? Decimal.zero;

  /// A copy with [line] set to [value], clamped to 0 … ordered.
  DeliveryForm withQty(OrderLine line, Decimal value) {
    var v = value;
    if (v < Decimal.zero) v = Decimal.zero;
    if (v > line.qty) v = line.qty;
    return DeliveryForm(order, {..._qty, line.id: Qty.round3(v)});
  }

  DeliveryForm increment(OrderLine line) =>
      withQty(line, qtyOf(line) + Decimal.one);

  DeliveryForm decrement(OrderLine line) =>
      withQty(line, qtyOf(line) - Decimal.one);

  /// Every line as ordered.
  DeliveryForm all() => DeliveryForm(order);

  bool isFull(OrderLine line) => qtyOf(line) == line.qty;

  /// Free units going with their paid line, in proportion: whole units when
  /// the free quantity ordered is whole, else to 0.001, half up.
  Decimal freeQtyOf(OrderLine free) {
    final paid = order.lines.where(
      (l) => !l.isFree && l.position == free.freeOfPosition,
    );
    if (paid.isEmpty) return Decimal.zero;
    final p = paid.first;
    final part = qtyOf(p);
    if (p.qty <= Decimal.zero || part <= Decimal.zero) return Decimal.zero;
    if (part >= p.qty) return free.qty;
    final exact = (free.qty * part / p.qty).toDecimal(
      scaleOnInfinitePrecision: 10,
    );
    return free.qty.isInteger
        ? exact.round()
        : exact.round(scale: Qty.decimals);
  }

  bool get anyDelivered => paidLines.any((l) => qtyOf(l) > Decimal.zero);

  /// Lines with something delivered (free lines counted with their paid line).
  int get deliveredLineCount =>
      paidLines.where((l) => qtyOf(l) > Decimal.zero).length;

  bool get isPartial => paidLines.any((l) => !isFull(l));

  /// The stock of the truck (or dépôt) that delivers, in the line's unit.
  Decimal? stockInUnit(OrderLine line) {
    final base = line.availableBase;
    if (base == null || line.factorToBase <= Decimal.zero) return null;
    return UnitConversion.fromBase(base, line.factorToBase);
  }

  /// More is delivered than the stock shows: a warning only, the tenant's
  /// negative-stock rule decides on the server.
  bool overStock(OrderLine line) {
    final base = line.availableBase;
    if (base == null) return false;
    return UnitConversion.toBase(qtyOf(line), line.factorToBase) > base;
  }

  /// Same rule as `computeTotals` in packages/shared (and the web's dialog):
  /// line HT rounded to 2 decimals after the remise, TVA per rate on the
  /// summed HT of that rate. Free lines are priced 0.
  DeliveryTotals get totals {
    final byRate = <Decimal, Decimal>{};
    var ht = Decimal.zero;
    for (final l in paidLines) {
      final lineHt = Money.round2(
        (qtyOf(l) *
                l.unitPriceHt *
                (Decimal.fromInt(100) - l.discountPct) /
                Decimal.fromInt(100))
            .toDecimal(scaleOnInfinitePrecision: 10),
      );
      ht += lineHt;
      byRate[l.tvaRate] = (byRate[l.tvaRate] ?? Decimal.zero) + lineHt;
    }
    var tva = Decimal.zero;
    if (order.assujettiTva) {
      for (final e in byRate.entries) {
        tva += Money.round2(
          (e.value * e.key / Decimal.fromInt(100)).toDecimal(
            scaleOnInfinitePrecision: 10,
          ),
        );
      }
    }
    return DeliveryTotals(totalHt: ht, totalTva: tva, totalTtc: ht + tva);
  }

  /// `deliverOrderSchema` for this form. Every paid line is sent (0 for a
  /// rupture); free lines are left to the API.
  Map<String, dynamic> body({
    required Decimal paid,
    required PaymentModeValue mode,
    required Map<String, int> packagingReturned,
    required Map<String, dynamic> geo,
  }) => {
    'lines': [
      for (final l in paidLines)
        {'orderLineId': l.id, 'qty': Qty.toApi(qtyOf(l))},
    ],
    'paidAmount': Money.toApi(paid),
    'paymentMode': mode.api,
    'packagingReturned': [
      for (final e in packagingReturned.entries)
        if (e.value > 0) {'packagingTypeId': e.key, 'qty': e.value},
    ],
    'geo': geo,
  };
}
