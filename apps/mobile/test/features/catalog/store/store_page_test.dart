import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_category_bar.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_product_row.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../app_harness.dart';
import '../store_fixtures.dart';

Finder _row(String name) =>
    find.ancestor(of: find.text(name), matching: find.byType(StoreProductRow));

/// The plain products' round "+" (tooltip "Add to cart").
bool _addEnabled(WidgetTester tester, String productName) {
  final ink = tester.widget<InkWell>(
    find.descendant(
      of: find.descendant(
        of: _row(productName),
        matching: find.byTooltip('Add to cart'),
      ),
      matching: find.byType(InkWell),
    ),
  );
  return ink.onTap != null;
}

/// Tall enough to build every row of the fixture menu.
const _tall = Size(360, 1800);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'header, section pills and the products of the selected section only',
    (tester) async {
      final repo = FakeCatalogRepository();
      await pumpCatalogApp(
        tester,
        location: '/store/s1',
        repository: repo,
        cart: CartCubit(),
        size: _tall,
      );

      expect(find.text('Pizza Palace'), findsWidgets);
      expect(find.text('All'), findsOneWidget);
      expect(find.text('Pizzas'), findsOneWidget);
      expect(find.byType(StoreProductRow), findsNWidgets(4));
      // Two requests: the store and the first "All" page.
      expect(repo.storeCalls, 1);
      expect(repo.queries, hasLength(1));

      await tester.drag(find.byType(StoreCategoryBar), const Offset(-300, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Boissons'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<StoreCategoryBar>(find.byType(StoreCategoryBar))
            .selectedId,
        'drinks',
      );
      expect(find.byType(StoreProductRow), findsOneWidget);
      expect(find.text('Hamoud'), findsOneWidget);
      expect(find.text('Margherita'), findsNothing);

      await tester.drag(find.byType(StoreCategoryBar), const Offset(300, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pizzas'));
      await tester.pumpAndSettle();
      expect(find.byType(StoreProductRow), findsNWidgets(2));
      expect(find.text('Pizza Tortels'), findsOneWidget);
      expect(find.text('Hamoud'), findsNothing);
    },
  );

  testWidgets('selected pill is announced as selected', (tester) async {
    await pumpCatalogApp(
      tester,
      location: '/store/s1',
      repository: FakeCatalogRepository(),
      cart: CartCubit(),
    );
    final handle = tester.ensureSemantics();
    expect(
      tester.getSemantics(find.bySemanticsLabel('All, 4 products')),
      containsSemantics(
        isButton: true,
        isSelected: true,
        hasSelectedState: true,
        hasTapAction: true,
      ),
    );
    handle.dispose();
  });

  testWidgets('a closed store shows its menu with "+" disabled', (
    tester,
  ) async {
    final repo = FakeCatalogRepository(
      store: restaurant(isOpen: false),
      products: menu(storeOpen: false),
    );
    await pumpCatalogApp(
      tester,
      location: '/store/s1',
      repository: repo,
      cart: CartCubit(),
      size: _tall,
    );

    expect(textContaining('Closed now'), findsWidgets);
    expect(find.byType(StoreProductRow), findsNWidgets(4));
    expect(_addEnabled(tester, 'Hamoud'), isFalse);
  });

  testWidgets('an open store adds a plain product from its row', (
    tester,
  ) async {
    final cart = CartCubit();
    await pumpCatalogApp(
      tester,
      location: '/store/s1',
      repository: FakeCatalogRepository(),
      cart: cart,
      size: _tall,
    );
    expect(_addEnabled(tester, 'Hamoud'), isTrue);
    await tester.tap(
      find.descendant(
        of: _row('Hamoud'),
        matching: find.byTooltip('Add to cart'),
      ),
    );
    await tester.pumpAndSettle();
    expect(cart.qtyOfProduct('d1'), 1);
    await settleTimers(tester);
  });

  testWidgets(
    'switching to a short section keeps the pills pinned at the top',
    (tester) async {
      await pumpCatalogApp(
        tester,
        location: '/store/s1',
        repository: FakeCatalogRepository(),
        cart: CartCubit(),
      );
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -2000));
      await tester.pumpAndSettle();
      final pinnedTop = tester.getTopLeft(find.byType(StoreCategoryBar)).dy;

      await tester.drag(find.byType(StoreCategoryBar), const Offset(-300, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Boissons'));
      await tester.pumpAndSettle();

      expect(find.byType(StoreProductRow), findsOneWidget);
      expect(tester.getTopLeft(find.byType(StoreCategoryBar)).dy, pinnedTop);
    },
  );

  for (final locale in ['ar', 'fr']) {
    testWidgets(
      'renders in $locale at 360 px and text scale 1.3 without overflow',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = 1.3;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await pumpCatalogApp(
          tester,
          location: '/store/s1',
          repository: FakeCatalogRepository(),
          cart: CartCubit(),
          locale: locale,
        );
        expect(tester.takeException(), isNull);
        await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
    );
  }
}
