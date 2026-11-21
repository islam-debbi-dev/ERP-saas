import 'package:freezed_annotation/freezed_annotation.dart';

import '../../catalog/data/models/home_feed.dart';
import '../data/models/cart_line.dart';

part 'cart_state.freezed.dart';

/// Cart contents plus the shop pricing rules from `/home` or `/app/config`.
@freezed
abstract class CartState with _$CartState {
  const CartState._();

  const factory CartState({
    @Default(<CartLine>[]) List<CartLine> lines,
    @Default(true) bool orderingEnabled,
    @Default(0) num deliveryFeeSetting,
    @Default(0) num minOrderAmount,

    /// Every-Nth-order free delivery progress (signed-in clients).
    LoyaltyStatus? loyalty,

    /// Server message per line key after an order was refused because of a
    /// size / option (`PRODUCT_OPTION_*`), shown on that cart line.
    @Default(<String, String>{}) Map<String, String> lineErrors,
  }) = _CartState;

  bool get isEmpty => lines.isEmpty;

  /// Distinct products, for the cart badge.
  int get lineCount => lines.length;

  num get subtotal => lines.fold<num>(0, (sum, line) => sum + line.lineTotal);

  /// `0` when delivery is free (loyalty reward, same rule as the backend);
  /// otherwise `null`: the admin calls the client to confirm the fee after
  /// the order is placed.
  num? get deliveryFee => loyaltyFreeNext || deliveryFeeSetting <= 0 ? 0 : null;

  /// Items total, plus the fee only when it is already known (free).
  num get total => subtotal + (deliveryFee ?? 0);

  /// This order is the client's loyalty reward (every Nth order).
  bool get loyaltyFreeNext => loyalty?.nextOrderFree ?? false;

  /// Backend checks the minimum only for orders that contain items.
  bool get meetsMinimum =>
      isEmpty || minOrderAmount <= 0 || subtotal >= minOrderAmount;

  bool get canCheckout => orderingEnabled && !isEmpty && meetsMinimum;

  /// Total quantity of a product across all its lines (sizes / options).
  num qtyOf(String productId) => lines
      .where((line) => line.productId == productId)
      .fold<num>(0, (sum, line) => sum + line.qty);

  /// Quantity of one line, by its key.
  num qtyOfLine(String lineKey) {
    for (final line in lines) {
      if (line.lineKey == lineKey) return line.qty;
    }
    return 0;
  }
}
