import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/features/cart/data/models/cart_line.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/cart/ui/widgets/cart_flight.dart';
import 'package:orvynt_starter/features/cart/ui/widgets/cart_icon_button.dart';
import 'package:orvynt_starter/features/cart/ui/widgets/floating_cart_bar.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/product_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../catalog/store_fixtures.dart';

/// A screen with the cart icon in its app bar (unless [withIcon] is false)
/// and [body] under it, at 360 px with the real locale files.
Future<void> _pump(
  WidgetTester tester, {
  required CartCubit cart,
  Widget body = const SizedBox.shrink(),
  bool withIcon = true,
  bool reduceMotion = false,
  String locale = 'en',
  Size size = const Size(360, 780),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.runAsync(() async {
    await tester.pumpWidget(
      BlocProvider<CartCubit>.value(
        value: cart,
        child: MaterialApp(
          theme: appThemeLight,
          locale: Locale(locale),
          supportedLocales: const [Locale('en'), Locale('ar'), Locale('fr')],
          localizationsDelegates: const [
            AppLocalizationsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (context, app) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(disableAnimations: reduceMotion),
            child: app!,
          ),
          home: Scaffold(
            appBar: AppBar(actions: [if (withIcon) const CartIconButton()]),
            body: body,
          ),
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await tester.pumpAndSettle();
}

/// Current scale of the bag icon.
double _bagScale(WidgetTester tester) {
  final transform = tester.widget<Transform>(
    find
        .ancestor(
          of: find.byIcon(Icons.shopping_bag_outlined),
          matching: find.byType(Transform),
        )
        .first,
  );
  // x scale (getMaxScaleOnAxis would hide values under 1 behind z = 1).
  return transform.transform.storage[0];
}

/// The ring painter behind the icon (only while it expands).
Finder get _ring => find.descendant(
  of: find.byType(CartIconButton),
  matching: find.byWidgetPredicate(
    (w) => w is CustomPaint && w.painter != null,
  ),
);

Finder _badge(String count) => find.descendant(
  of: find.byType(CartIconButton),
  matching: find.text(count),
);

Product _product(String id) => plain(id, 'Dish $id', 'c1');

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    CartFlight.reset();
  });

  group('CartIconButton add animation', () {
    testWidgets('an add pops the bag, sends a ring and shows the new count', (
      tester,
    ) async {
      final cart = CartCubit();
      await _pump(tester, cart: cart);
      expect(_bagScale(tester), 1);
      expect(_ring, findsNothing);

      cart.add(_product('a'));
      await tester.pump();
      // First tick starts the controller, then 120 ms in.
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pump(const Duration(milliseconds: 120));
      expect(_bagScale(tester), greaterThan(1.05));
      expect(_ring, findsOneWidget);

      await tester.pumpAndSettle();
      expect(_bagScale(tester), 1);
      expect(_ring, findsNothing);
      expect(_badge('1'), findsOneWidget);
    });

    testWidgets('the badge scales in from 0 on the first item', (tester) async {
      final cart = CartCubit();
      await _pump(tester, cart: cart);
      expect(_badge('1'), findsNothing);

      cart.add(_product('a'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pump(const Duration(milliseconds: 90));
      final badgeScale = tester
          .widget<Transform>(
            find
                .ancestor(of: _badge('1'), matching: find.byType(Transform))
                .first,
          )
          .transform
          .storage[0];
      expect(badgeScale, lessThan(1));

      await tester.pumpAndSettle();
      expect(_badge('1'), findsOneWidget);
    });

    testWidgets('fast repeat adds never throw nor leave the icon scaled', (
      tester,
    ) async {
      final cart = CartCubit();
      await _pump(tester, cart: cart);
      for (var i = 0; i < 6; i++) {
        cart.add(_product('p$i'));
        await tester.pump(const Duration(milliseconds: 60));
      }
      // The same line again: a pop without a count change.
      cart.add(_product('p0'));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(_bagScale(tester), 1);
      expect(_ring, findsNothing);
      expect(_badge('6'), findsOneWidget);
    });

    testWidgets('Reduce Motion: new count without scale or ring', (
      tester,
    ) async {
      final cart = CartCubit();
      await _pump(tester, cart: cart, reduceMotion: true);
      cart.add(_product('a'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 80));
      expect(_bagScale(tester), 1);
      expect(_ring, findsNothing);
      await tester.pumpAndSettle();
      expect(_badge('1'), findsOneWidget);
    });

    testWidgets('restore() shows the saved count without animating', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({
        CartCubit.storageKey: jsonEncode([
          CartLine.fromProduct(_product('a'), 1).toJson(),
          CartLine.fromProduct(_product('b'), 1).toJson(),
        ]),
      });
      final cart = CartCubit();
      await _pump(tester, cart: cart);
      await tester.runAsync(cart.restore);
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
      expect(_bagScale(tester), 1);
      expect(_ring, findsNothing);
      expect(_badge('2'), findsOneWidget);
    });

    testWidgets('the semantics label carries the count', (tester) async {
      final handle = tester.ensureSemantics();
      final cart = CartCubit();
      await _pump(tester, cart: cart);
      expect(find.bySemanticsLabel('Cart'), findsOneWidget);
      cart
        ..add(_product('a'))
        ..add(_product('b'))
        ..add(_product('c'));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Cart, 3 items'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('RTL at 360 px: animates and settles without overflow', (
      tester,
    ) async {
      final cart = CartCubit();
      await _pump(tester, cart: cart, locale: 'ar');
      for (var i = 0; i < 120; i++) {
        cart.add(_product('p$i'));
      }
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(_badge('99+'), findsOneWidget);
    });
  });

  group('fly-to-cart', () {
    Widget card(Product product) => Align(
      alignment: Alignment.bottomCenter,
      child: SizedBox(
        width: 180,
        height: 300,
        child: ProductCard(product: product),
      ),
    );

    testWidgets('the thumbnail flies, the count changes on impact, the '
        'overlay is removed', (tester) async {
      final cart = CartCubit();
      await _pump(tester, cart: cart, body: card(_product('a')));

      await tester.tap(find.byIcon(Icons.add_rounded));
      await tester.pump();
      expect(find.byType(CartFlightThumb), findsOneWidget);
      expect(cart.state.lineCount, 1);

      // Mid-flight: the icon has not reacted yet.
      await tester.pump(const Duration(milliseconds: 250));
      expect(_badge('1'), findsNothing);
      expect(_bagScale(tester), 1);

      // Impact: the thumbnail is gone and the icon pops.
      await tester.pump(const Duration(milliseconds: 320));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byType(CartFlightThumb), findsNothing);
      expect(_bagScale(tester), greaterThan(1));

      await tester.pumpAndSettle();
      expect(_badge('1'), findsOneWidget);
      expect(CartFlight.deferring, isFalse);
    });

    testWidgets('the floating bar shows up and bumps on impact, not at the '
        'tap', (tester) async {
      final cart = CartCubit();
      await _pump(
        tester,
        cart: cart,
        body: Column(
          children: [
            Expanded(child: card(_product('a'))),
            const FloatingCartBar(),
          ],
        ),
      );
      await tester.tap(find.byIcon(Icons.add_rounded));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.text('Added: Dish a'), findsNothing);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Added: Dish a'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
    });

    testWidgets('no flight without a cart icon on screen', (tester) async {
      final cart = CartCubit();
      await _pump(
        tester,
        cart: cart,
        withIcon: false,
        body: card(_product('a')),
      );
      await tester.tap(find.byIcon(Icons.add_rounded));
      await tester.pump();
      expect(find.byType(CartFlightThumb), findsNothing);
      expect(cart.state.lineCount, 1);
      await tester.pumpAndSettle();
    });

    testWidgets('no flight with Reduce Motion', (tester) async {
      final cart = CartCubit();
      await _pump(
        tester,
        cart: cart,
        reduceMotion: true,
        body: card(_product('a')),
      );
      await tester.tap(find.byIcon(Icons.add_rounded));
      await tester.pump();
      expect(find.byType(CartFlightThumb), findsNothing);
      await tester.pumpAndSettle();
      expect(_badge('1'), findsOneWidget);
    });

    testWidgets('at most three thumbnails fly at once', (tester) async {
      final cart = CartCubit();
      await _pump(
        tester,
        cart: cart,
        body: Wrap(
          children: [
            for (final id in ['a', 'b', 'c', 'd'])
              SizedBox(
                width: 175,
                height: 280,
                child: ProductCard(product: _product(id)),
              ),
          ],
        ),
      );
      for (var i = 0; i < 4; i++) {
        await tester.tap(find.byIcon(Icons.add_rounded).at(i));
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(find.byType(CartFlightThumb), findsNWidgets(3));
      expect(cart.state.lineCount, 4);
      await tester.pumpAndSettle();
      expect(find.byType(CartFlightThumb), findsNothing);
      expect(_badge('4'), findsOneWidget);
    });
  });
}
