import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/cart/data/models/cart_line.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_harness.dart';
import 'store_fixtures.dart';

Finder _addButton() => find.byKey(const ValueKey('customizer-add'));

bool _enabled(WidgetTester tester) {
  final button = tester.widget(
    find
        .descendant(
          of: _addButton(),
          matching: find.byWidgetPredicate(
            (w) => w is ButtonStyleButton || w is InkWell,
          ),
        )
        .first,
  );
  if (button is ButtonStyleButton) return button.onPressed != null;
  return (button as InkWell).onTap != null;
}

/// Centres [finder] first: at the edges it can sit under the pinned bar
/// or the "added" snackbar.
Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await Scrollable.ensureVisible(tester.element(finder), alignment: 0.5);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('adding the same dish twice with other choices makes two lines', (
    tester,
  ) async {
    final cart = CartCubit();
    await pumpCatalogApp(
      tester,
      location: '/product/a1',
      repository: FakeCatalogRepository(),
      cart: cart,
    );

    expect(textContaining('Add to cart · 360'), findsOneWidget);
    await _tapVisible(tester, find.text('Camembert'));
    expect(textContaining('Add to cart · 460'), findsOneWidget);
    await tester.tap(_addButton());
    await tester.pumpAndSettle();

    // The screen stays open, choices reset, the cart link appears.
    expect(textContaining('Add to cart · 360'), findsOneWidget);
    expect(find.text('View cart (1)'), findsOneWidget);
    // The "added" snackbar can cover the last rows of the page.
    await settleTimers(tester);

    await _tapVisible(tester, find.text('Sans tomate'));
    await tester.tap(_addButton());
    await tester.pumpAndSettle();

    expect(cart.state.lines.map((l) => l.lineKey), [
      'a1||camembert',
      'a1||sans-tomate',
    ]);
    expect(cart.qtyOfProduct('a1'), 2);
    expect(find.text('View cart (2)'), findsOneWidget);
    await settleTimers(tester);

    // Exactly the same choices again: merged into the existing line.
    await _tapVisible(tester, find.text('Sans tomate'));
    await tester.tap(_addButton());
    await tester.pumpAndSettle();
    expect(cart.state.lines, hasLength(2));
    expect(cart.state.qtyOfLine('a1||sans-tomate'), 2);
    await settleTimers(tester);
  });

  testWidgets('the button stays disabled until the required size is picked', (
    tester,
  ) async {
    await pumpCatalogApp(
      tester,
      location: '/product/p9',
      repository: FakeCatalogRepository(),
      cart: CartCubit(),
    );

    expect(find.text('Choose a size first'), findsOneWidget);
    expect(_enabled(tester), isFalse);
    await _tapVisible(tester, textContaining('XL · 1 100'));
    await _tapVisible(tester, find.text('Harissa'));
    expect(_enabled(tester), isTrue);
    expect(textContaining('Add to cart · 1 100'), findsOneWidget);
  });

  testWidgets('a closed store product is readable but not orderable', (
    tester,
  ) async {
    await pumpCatalogApp(
      tester,
      location: '/product/d1',
      repository: FakeCatalogRepository(products: menu(storeOpen: false)),
      cart: CartCubit(),
    );
    expect(
      find.text('The store is closed, ordering opens with it'),
      findsOneWidget,
    );
    expect(_enabled(tester), isFalse);
  });

  testWidgets('editing a cart line updates it and goes back', (tester) async {
    final cart = CartCubit();
    await pumpCatalogApp(
      tester,
      location: '/cart',
      repository: FakeCatalogRepository(),
      cart: cart,
    );
    final repo = FakeCatalogRepository();
    final dish = repo.products['plates']!.single;
    cart.addLine(dish, CartLine.fromProduct(dish, 1));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Assiette creuse'));
    await tester.pumpAndSettle();
    await _tapVisible(tester, find.text('Salade'));
    expect(textContaining('Update line · 460'), findsOneWidget);
    await tester.tap(_addButton());
    await tester.pumpAndSettle();

    expect(cart.state.lines.single.lineKey, 'a1||salade');
    expect(find.text('Cart'), findsOneWidget);
  });

  for (final locale in ['ar', 'fr']) {
    testWidgets(
      'product details render in $locale at 360 px without overflow',
      (tester) async {
        await pumpCatalogApp(
          tester,
          location: '/product/p9',
          repository: FakeCatalogRepository(),
          cart: CartCubit(),
          locale: locale,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
