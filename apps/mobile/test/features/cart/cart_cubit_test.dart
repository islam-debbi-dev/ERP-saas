import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/app_config.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/features/account/data/models/address.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:orvynt_starter/features/catalog/data/models/home_feed.dart';
import 'package:orvynt_starter/features/catalog/logic/customisation_rules.dart';
import 'dart:convert';

import 'package:orvynt_starter/features/cart/data/models/cart_line.dart';
import 'package:orvynt_starter/features/cart/ui/cart_screen.dart';

import '../catalog/customisation_fixtures.dart';

Product _product({
  String id = 'p1',
  num price = 100,
  num finalPrice = 100,
  String unit = 'piece',
  num unitStep = 1,
}) => Product(
  id: id,
  storeId: 's1',
  categoryId: 'c1',
  name: 'Item $id',
  price: price,
  finalPrice: finalPrice,
  unit: unit,
  unitStep: unitStep,
);

void main() {
  // CartCubit.add triggers haptic feedback, which needs the binding.
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('adds, steps and removes lines', () {
    final cart = CartCubit();
    final apples = _product(unit: 'kg', unitStep: 0.5, finalPrice: 300);

    cart.add(apples);
    cart.add(apples);
    cart.add(apples);
    expect(cart.state.qtyOf('p1'), 1.5);
    expect(cart.state.subtotal, 450);

    cart.decrement('p1||');
    cart.decrement('p1||');
    cart.decrement('p1||');
    expect(cart.state.isEmpty, isTrue);
  });

  test('applies the backend delivery rules', () {
    final cart = CartCubit()
      ..applyConfig(
        const AppConfig(
          orderingEnabled: true,
          deliveryFee: 200,
          minOrderAmount: 300,
        ),
      );

    cart.add(_product(finalPrice: 250));
    // The fee is confirmed by phone after ordering, never shown upfront.
    expect(cart.state.deliveryFee, isNull);
    expect(cart.state.meetsMinimum, isFalse);
    expect(cart.state.canCheckout, isFalse);

    cart.setQty('p1||', 4);
    expect(cart.state.subtotal, 1000);
    expect(cart.state.deliveryFee, isNull);
    expect(cart.state.total, 1000);
    expect(cart.state.canCheckout, isTrue);
  });

  test('makes the loyalty order free and advances the counter', () {
    final cart = CartCubit()
      ..applyConfig(const AppConfig(orderingEnabled: true, deliveryFee: 200))
      ..add(_product());
    cart.emit(
      cart.state.copyWith(
        loyalty: const LoyaltyStatus(
          everyOrders: 3,
          ordersSinceFree: 2,
          nextOrderFree: true,
        ),
      ),
    );
    expect(cart.state.deliveryFee, 0);

    final free = cart.state.loyalty!.afterOrder(wasFree: true);
    expect(free.ordersUntilFree, 2);
    expect(free.nextOrderFree, isFalse);
    // Placed (not yet delivered) orders don't move the counter.
    expect(free.afterOrder(wasFree: false).ordersUntilFree, 2);
  });

  test('blocks checkout while ordering is disabled', () {
    final cart = CartCubit()
      ..applyConfig(const AppConfig(orderingEnabled: false))
      ..add(_product());
    expect(cart.state.canCheckout, isFalse);
  });

  test('builds the POST /orders body for a saved address', () {
    final cart = CartCubit()..add(_product(), qty: 2);
    const user = AuthUser(id: 'u1', name: 'Amine', phone: '+213555000201');
    const address = Address(id: 'a1', fullAddress: 'Rue 1, Alger');

    final body = cart
        .buildOrderRequest(user: user, address: address, note: ' ring ')
        .toJson();

    expect(body, {
      'items': [
        {'productId': 'p1', 'qty': 2},
      ],
      'customer': {'name': 'Amine', 'phone': '+213555000201', 'note': 'ring'},
      'addressId': 'a1',
    });
  });

  test('restores a persisted cart', () async {
    final first = CartCubit()..add(_product(), qty: 3);
    await Future<void>.delayed(Duration.zero);
    await first.close();

    final second = CartCubit();
    await second.restore();
    expect(second.state.qtyOf('p1'), 3);
  });

  group('customised lines', () {
    final dish = assiette();
    final rules = CustomisationRules(dish);
    CustomisationSelection pick(List<String> ids) =>
        CustomisationSelection(optionIds: ids.toSet());

    test('merges by line key: same choices stack, different choices split', () {
      final cart = CartCubit()
        ..addLine(dish, rules.toLine(pick(['camembert']), 1))
        ..addLine(dish, rules.toLine(pick(['camembert']), 1))
        ..addLine(dish, rules.toLine(pick([]), 1));

      expect(cart.state.lines, hasLength(2));
      expect(cart.state.qtyOfLine('a1||camembert'), 2);
      expect(cart.state.qtyOf('a1'), 3);
      // 2 × (360 + 100) + 360
      expect(cart.state.subtotal, 1280);
    });

    test('editing a line replaces it, and merges into an identical line', () {
      final cart = CartCubit()
        ..addLine(dish, rules.toLine(pick(['salade']), 1))
        ..addLine(dish, rules.toLine(pick(['camembert']), 2));

      cart.addLine(
        dish,
        rules.toLine(pick(['salade', 'sans-tomate']), 1),
        replacing: 'a1||salade',
      );
      expect(cart.state.lines.first.lineKey, 'a1||salade,sans-tomate');
      expect(cart.state.lines, hasLength(2));

      cart.addLine(
        dish,
        rules.toLine(pick(['camembert']), 1),
        replacing: 'a1||salade,sans-tomate',
      );
      expect(cart.state.lines, hasLength(1));
      expect(cart.state.qtyOfLine('a1||camembert'), 3);
    });

    test('sends variant and option ids, never prices', () {
      final pz = pizza();
      final pr = CustomisationRules(pz);
      var s = pr.selectVariant(pr.initial(), pz.variants[1]);
      s = s.copyWith(optionIds: {'camembert', 'harissa'});
      final cart = CartCubit()..addLine(pz, pr.toLine(s, 1));
      const user = AuthUser(id: 'u1', name: 'A', phone: '+213555000201');

      final items = cart.buildOrderRequest(user: user).toJson()['items'];
      expect(items, [
        {
          'productId': 'p9',
          'qty': 1,
          'variantId': 'XL',
          'optionIds': ['camembert', 'harissa'],
        },
      ]);
    });

    test('keeps the server error on its line until that line changes', () {
      final cart = CartCubit()
        ..addLine(dish, rules.toLine(pick(['camembert']), 1))
        ..add(_product());
      cart.markLineError(cart.lineKeyAt(0)!, 'Camembert finished');
      expect(cart.state.lineErrors['a1||camembert'], 'Camembert finished');

      cart.increment('p1||');
      expect(cart.state.lineErrors, hasLength(1));
      cart.remove('a1||camembert');
      expect(cart.state.lineErrors, isEmpty);
    });

    test('migrates v1 lines to v2 as plain lines', () async {
      SharedPreferences.setMockInitialValues({
        CartCubit.legacyStorageKey: jsonEncode([
          {'productId': 'p1', 'name': 'Old', 'unitPrice': 250, 'qty': 2},
        ]),
      });
      final cart = CartCubit();
      await cart.restore();

      expect(cart.state.lines.single.lineKey, 'p1||');
      expect(cart.state.subtotal, 500);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(CartCubit.legacyStorageKey), isNull);
      expect(prefs.getString(CartCubit.storageKey), isNotNull);
    });

    test('qtyOfProduct sums every line of the product (card badge)', () {
      final cart = CartCubit()
        ..addLine(dish, rules.toLine(pick(['camembert']), 1))
        ..addLine(dish, rules.toLine(pick([]), 2))
        ..add(_product());

      expect(cart.state.lines, hasLength(3));
      expect(cart.qtyOfProduct('a1'), 3);
      expect(cart.qtyOfProduct('p1'), 1);
      expect(cart.qtyOfProduct('unknown'), 0);
    });
  });

  test('cart sections: grouped by store, same product lines side by side', () {
    CartLine line(String product, String store, [String option = '']) =>
        CartLine(
          productId: product,
          name: product,
          unitPrice: 100,
          qty: 1,
          storeId: store,
          storeName: 'Store $store',
          options: [
            if (option.isNotEmpty) CartOption(id: option, label: option),
          ],
        );
    final groups = groupCartLines([
      line('a', 's1', 'x'),
      line('b', 's2'),
      line('c', 's1'),
      line('a', 's1'),
    ]);

    expect(groups.map((g) => g.storeName), ['Store s1', 'Store s2']);
    expect(groups.first.lines.map((l) => l.lineKey), ['a||x', 'a||', 'c||']);
    expect(groups.last.lines.single.productId, 'b');
  });
}
