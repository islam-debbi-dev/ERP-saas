import 'package:decimal/decimal.dart';

import '../../../core/helpers/money.dart';
import '../../../core/models/product_unit.dart';
import '../../catalog/data/models/product.dart';

/// The client of a sale or order. Null client = vente comptoir (cash only).
class BasketClient {
  const BasketClient({
    required this.id,
    required this.code,
    required this.name,
    this.balance,
    this.creditLimit,
  });

  final String id;
  final String code;
  final String name;
  final Decimal? balance;
  final Decimal? creditLimit;
}

/// One line of the basket: a product in one of its units.
class BasketLine {
  const BasketLine({
    required this.product,
    required this.unit,
    required this.qty,
    this.discountPct,
  });

  final Product product;
  final ProductUnit unit;
  final Decimal qty;

  /// Typed remise; null = what the price level / promotion gives.
  final Decimal? discountPct;

  bool sameAs(Product p, ProductUnit u) =>
      product.id == p.id && unit.unitId == u.unitId;

  /// The quantity in the product's base unit (for the truck's stock).
  Decimal get qtyBase => unit.toBase(qty);

  BasketLine copyWith({
    ProductUnit? unit,
    Decimal? qty,
    Decimal? discountPct,
    bool clearDiscount = false,
  }) => BasketLine(
    product: product,
    unit: unit ?? this.unit,
    qty: qty ?? this.qty,
    discountPct: clearDiscount ? null : (discountPct ?? this.discountPct),
  );

  /// `saleLineInputSchema`: strings only, never a double.
  Map<String, dynamic> toJson() => {
    'productId': product.id,
    'unitId': unit.unitId,
    'qty': Qty.toApi(qty),
    if (discountPct != null && discountPct! > Decimal.zero)
      'discountPct': discountPct!.round(scale: 2).toStringAsFixed(2),
  };
}

/// Who may give a remise, and how much (the API checks the same:
/// PRICE_OVERRIDE to touch a line, DISCOUNT_ABOVE_X above the tenant's
/// `maxDiscountPct`).
class DiscountPolicy {
  const DiscountPolicy({
    required this.canDiscount,
    required this.aboveCeiling,
    required this.ceiling,
  });

  const DiscountPolicy.none()
    : canDiscount = false,
      aboveCeiling = false,
      ceiling = null;

  final bool canDiscount;
  final bool aboveCeiling;

  /// `maxDiscountPct`; null until loaded.
  final Decimal? ceiling;

  static final hundred = Decimal.fromInt(100);

  /// The highest remise the user may type.
  Decimal get maxPct => aboveCeiling ? hundred : (ceiling ?? Decimal.zero);

  /// [pct] brought within 0..[maxPct]; null when the user may not discount.
  Decimal? clamp(Decimal pct) {
    if (!canDiscount) return null;
    if (pct < Decimal.zero) return Decimal.zero;
    return pct > maxPct ? maxPct : pct;
  }
}

enum PaymentModeValue { especes, cheque, virement }

extension PaymentModeApi on PaymentModeValue {
  String get api => switch (this) {
    PaymentModeValue.especes => 'ESPECES',
    PaymentModeValue.cheque => 'CHEQUE',
    PaymentModeValue.virement => 'VIREMENT',
  };
}

/// The body of `POST /sales/quick` (`quickSaleSchema`).
Map<String, dynamic> quickSaleBody({
  required BasketClient? client,
  required List<BasketLine> lines,
  required String documentDate,
  required String? truckId,
  required Decimal paid,
  required PaymentModeValue mode,
  required Map<String, int> packagingReturned,
  required Map<String, dynamic> geo,
}) => {
  'type': 'BL',
  'clientId': client?.id,
  'documentDate': documentDate,
  'lines': [for (final l in lines) l.toJson()],
  // The truck the goods leave from; null lets the API pick the seller's.
  'warehouseId': truckId,
  'paidAmount': Money.toApi(paid),
  'paymentMode': mode.api,
  'geo': geo,
  'packagingReturned': [
    for (final e in packagingReturned.entries)
      if (e.value > 0) {'packagingTypeId': e.key, 'qty': e.value},
  ],
};
