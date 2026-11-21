import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/models/app_config.dart';
import '../../../core/models/auth_user.dart';
import '../../../core/models/geo_point.dart';
import '../../account/data/models/address.dart';
import '../../catalog/data/models/home_feed.dart';
import '../../catalog/data/models/product.dart';
import '../../order/data/models/create_order_request.dart';
import '../../order/data/models/order.dart';
import '../data/models/cart_line.dart';
import 'cart_state.dart';

/// Local cart, persisted in shared_preferences across launches.
///
/// Lines are keyed by [CartLine.lineKey] (`productId|variantId|optionIds`),
/// so the same dish with and without camembert are two lines.
class CartCubit extends Cubit<CartState> {
  CartCubit() : super(const CartState());

  static const storageKey = 'cart_lines_v2';

  /// Lines saved before sizes / options existed; migrated once on restore.
  static const legacyStorageKey = 'cart_lines_v1';

  final _added = StreamController<Product>.broadcast();

  /// Fires on every [add], so the floating cart bar can confirm it.
  Stream<Product> get added => _added.stream;

  @override
  Future<void> close() {
    _added.close();
    return super.close();
  }

  Future<void> restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(storageKey);
      final legacy = raw == null ? prefs.getString(legacyStorageKey) : null;
      final source = raw ?? legacy;
      if (source == null) return;
      // v1 lines have no size / options: they read as plain lines.
      final lines = (jsonDecode(source) as List<dynamic>)
          .map((e) => CartLine.fromJson(e as Map<String, dynamic>))
          .toList();
      emit(state.copyWith(lines: lines));
      if (legacy != null) {
        await _persist(lines);
        await prefs.remove(legacyStorageKey);
      }
    } catch (e) {
      debugPrint('CartCubit: dropping unreadable saved cart: $e');
    }
  }

  void applyConfig(AppConfig config) => emit(
    state.copyWith(
      orderingEnabled: config.orderingEnabled,
      deliveryFeeSetting: config.deliveryFee,
      minOrderAmount: config.minOrderAmount,
    ),
  );

  /// `/home` carries the same fees but not `minOrderAmount`.
  void applyHomeFeed(HomeFeed feed) => emit(
    state.copyWith(
      orderingEnabled: feed.orderingEnabled,
      deliveryFeeSetting: feed.deliveryFee,
      loyalty: feed.loyalty,
    ),
  );

  /// Advances the loyalty counter after [order] is placed.
  void onOrderPlaced(Order order) {
    final loyalty = state.loyalty;
    if (loyalty == null) return;
    emit(
      state.copyWith(
        loyalty: loyalty.afterOrder(
          wasFree: order.freeDeliveryReason == 'loyalty',
        ),
      ),
    );
  }

  /// Adds one `unitStep` (or [qty]) of a plain [product] (no choices).
  void add(Product product, {num? qty}) =>
      addLine(product, CartLine.fromProduct(product, qty ?? product.unitStep));

  /// Adds [line] (a product with its choices), merging into the line with the
  /// same key. With [replacing], that line is edited instead (removed first;
  /// if the edit makes it identical to another line, the two merge).
  void addLine(Product product, CartLine line, {String? replacing}) {
    final lines = [
      for (final l in state.lines)
        if (l.lineKey != replacing) l,
    ];
    final key = line.lineKey;
    final index = lines.indexWhere((l) => l.lineKey == key);
    if (index == -1) {
      HapticFeedback.mediumImpact();
      final at = replacing == null
          ? lines.length
          : state.lines.indexWhere((l) => l.lineKey == replacing);
      lines.insert(
        at < 0 || at > lines.length ? lines.length : at,
        line.withQty(_round(line.qty)),
      );
    } else {
      HapticFeedback.selectionClick();
      final existing = lines[index];
      lines[index] = existing
          .copyWith(unitPrice: line.unitPrice)
          .withQty(_round(existing.qty + line.qty));
    }
    _save(lines, clearErrorsFor: {key, ?replacing});
    _added.add(product);
  }

  /// Total quantity of a product across all its lines (card badge).
  num qtyOfProduct(String productId) => state.qtyOf(productId);

  /// One step down; removes the line at zero.
  void decrement(String lineKey) {
    final line = _line(lineKey);
    if (line == null) return;
    setQty(lineKey, line.qty - line.unitStep);
  }

  /// One step up.
  void increment(String lineKey) {
    final line = _line(lineKey);
    if (line == null) return;
    setQty(lineKey, line.qty + line.unitStep);
  }

  void setQty(String lineKey, num qty) {
    final rounded = _round(qty);
    _save([
      for (final line in state.lines)
        if (line.lineKey != lineKey)
          line
        else if (rounded > 0)
          line.withQty(rounded),
    ], clearErrorsFor: rounded > 0 ? const {} : {lineKey});
  }

  void remove(String lineKey) => setQty(lineKey, 0);

  /// Shows the server's refusal on the line it is about.
  void markLineError(String lineKey, String message) =>
      emit(state.copyWith(lineErrors: {...state.lineErrors, lineKey: message}));

  /// Line key of the [index]-th item sent in the last order request.
  String? lineKeyAt(int index) => index >= 0 && index < state.lines.length
      ? state.lines[index].lineKey
      : null;

  void clear() => _save(const []);

  /// Builds the `POST /orders` body. With a saved [address] the server uses
  /// its snapshot; otherwise [manualAddress] (and optional [location]) apply.
  CreateOrderRequest buildOrderRequest({
    required AuthUser user,
    Address? address,
    String? manualAddress,
    GeoPoint? location,
    String? note,
    String? customRequest,
  }) => CreateOrderRequest(
    items: [
      for (final line in state.lines)
        CreateOrderItem(
          productId: line.productId,
          qty: line.qty,
          variantId: line.variantId,
          optionIds: line.options.isEmpty
              ? null
              : [for (final o in line.options) o.id],
        ),
    ],
    customRequest: _blankToNull(customRequest),
    addressId: address?.id,
    customer: CreateOrderCustomer(
      name: user.name,
      phone: user.phone,
      address: address == null ? _blankToNull(manualAddress) : null,
      location: address == null ? location : null,
      note: _blankToNull(note),
    ),
  );

  CartLine? _line(String lineKey) {
    for (final line in state.lines) {
      if (line.lineKey == lineKey) return line;
    }
    return null;
  }

  void _save(List<CartLine> lines, {Set<String> clearErrorsFor = const {}}) {
    final keys = lines.map((l) => l.lineKey).toSet();
    final errors = {
      for (final entry in state.lineErrors.entries)
        if (keys.contains(entry.key) && !clearErrorsFor.contains(entry.key))
          entry.key: entry.value,
    };
    emit(state.copyWith(lines: lines, lineErrors: errors));
    _persist(lines);
  }

  Future<void> _persist(List<CartLine> lines) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        storageKey,
        jsonEncode(lines.map((l) => l.toJson()).toList()),
      );
    } catch (e) {
      debugPrint('CartCubit: failed to persist cart: $e');
    }
  }

  /// Avoids `0.1 + 0.2` drift on fractional (kg / liter) steps.
  static num _round(num qty) {
    final value = (qty * 1000).round() / 1000;
    return value == value.roundToDouble() ? value.toInt() : value;
  }

  static String? _blankToNull(String? value) =>
      value == null || value.trim().isEmpty ? null : value.trim();
}
