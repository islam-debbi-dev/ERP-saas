// Throwaway simulator probe (git-ignored): home → store card → store page
// (switch section, swipe) → product (scroll the header) → add → cart.
// Same finders on master and on the branch, for before / after shots.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/router/app_router.dart';
import 'package:orvynt_starter/core/router/routes.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_category_bar.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_product_row.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/store_tile.dart';
import 'package:orvynt_starter/main.dart' as app;
import 'package:shared_preferences/shared_preferences.dart';

const shots = String.fromEnvironment('SHOTS');
const tag = String.fromEnvironment('TAG', defaultValue: 'x');
const locale = String.fromEnvironment('LOC', defaultValue: 'ar');
const theme = String.fromEnvironment('THEME', defaultValue: 'dark');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('phase 6 probe', (tester) async {
    final errors = <String>[];
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      errors.add(details.exceptionAsString().split('\n').first);
      previous?.call(details);
    };

    Future<void> settle([int quarterSeconds = 12]) async {
      for (var i = 0; i < quarterSeconds; i++) {
        await tester.pump(const Duration(milliseconds: 250));
      }
    }

    Future<void> shot(String name) async {
      await settle();
      await tester.runAsync(() async {
        final view = binding.rootElement!.renderObject! as RenderView;
        final layer = view.debugLayer! as OffsetLayer;
        final image = await layer.toImage(
          Offset.zero & view.paintBounds.size,
          pixelRatio: 1,
        );
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(
          '$shots/${tag}_$name.png',
        ).writeAsBytes(png!.buffer.asUint8List());
      });
      // ignore: avoid_print
      print('SHOT ${tag}_$name errors=${errors.length}');
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('locale', locale);
    await prefs.setString('theme_mode', theme);

    app.main();
    await settle(20);
    await tester.runAsync(
      () => getIt<SessionCubit>().login('+213555000201', 'Jibli@2026'),
    );
    appRouter.go(Routes.home);
    await shot('1_home_top');

    // Home: bring the restaurants row into view.
    final homeList = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(
      find.byType(StoreTile).first,
      200,
      scrollable: homeList,
    );
    await tester.drag(homeList, const Offset(0, 140));
    await shot('2_home_stores');

    appRouter.push(Routes.stores);
    await shot('3_all_stores');
    appRouter.pop();
    await settle(4);

    await Scrollable.ensureVisible(
      tester.element(find.byType(StoreTile).first),
      alignment: 0.5,
    );
    await settle(2);
    await tester.tap(find.byType(StoreTile).first);
    await shot('4_store');

    // Second section of the bar.
    final barTexts = find.descendant(
      of: find.byType(StoreCategoryBar),
      matching: find.byType(Text),
    );
    final labels = barTexts
        .evaluate()
        .map((e) => (e.widget as Text).data ?? '')
        .where((t) => t.isNotEmpty && int.tryParse(t) == null)
        .toList();
    // ignore: avoid_print
    print('SECTIONS $labels');
    if (labels.length > 1) {
      await tester.tap(find.text(labels[1]).first);
      await shot('5_store_section');
      // Swipe to the next section (towards the reading start).
      if (find.byType(StoreProductRow).evaluate().isNotEmpty) {
        await tester.fling(
          find.byType(StoreProductRow).first,
          Offset(locale == 'ar' ? 300 : -300, 0),
          1200,
        );
        await shot('6_store_swiped');
      }
    }

    // Product page.
    if (find.byType(StoreProductRow).evaluate().isNotEmpty) {
      await Scrollable.ensureVisible(
        tester.element(find.byType(StoreProductRow).first),
        alignment: 0.6,
      );
      await settle(2);
      await tester.tap(find.byType(StoreProductRow).first);
      await shot('7_product');
      final productList = find.byType(Scrollable).first;
      await tester.drag(productList, const Offset(0, -260));
      await shot('8_product_mid');
      await tester.drag(productList, const Offset(0, -400));
      await shot('9_product_scrolled');
      await tester.drag(productList, const Offset(0, 900));
      await settle(4);
      final add = find.byKey(const ValueKey('customizer-add'));
      if (add.evaluate().isNotEmpty) {
        await tester.tap(add);
        await settle(4);
      }
    }
    appRouter.push(Routes.cart);
    await shot('10_cart');

    for (final e in errors.toSet()) {
      // ignore: avoid_print
      print('ERR $e');
    }
  });
}
