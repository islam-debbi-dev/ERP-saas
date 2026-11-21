// Throwaway simulator probe (not committed): home → "Popular dishes"
// (premium cards, peek, infinite loading) → + on a card (flight burst) →
// tap a card (Hero) → store → + on a row (burst), + ×3 fast → product with
// options → add (burst) → back.
// Finders match by type name so the same file runs before / after.
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
import 'package:orvynt_starter/main.dart' as app;
import 'package:shared_preferences/shared_preferences.dart';

const shots = String.fromEnvironment('SHOTS');
const tag = String.fromEnvironment('TAG', defaultValue: 'x');
const locale = String.fromEnvironment('LOC', defaultValue: 'ar');
const theme = String.fromEnvironment('THEME', defaultValue: 'dark');
const onlyHome = bool.fromEnvironment('ONLY_HOME');

Finder byTypeName(String name) =>
    find.byWidgetPredicate((w) => w.runtimeType.toString() == name);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('phase 7 probe', (tester) async {
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

    Future<void> capture(String name, {double ratio = 1}) async {
      await tester.runAsync(() async {
        final view = binding.rootElement!.renderObject! as RenderView;
        final layer = view.debugLayer! as OffsetLayer;
        final image = await layer.toImage(
          Offset.zero & view.paintBounds.size,
          pixelRatio: ratio,
        );
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(
          '$shots/${tag}_$name.png',
        ).writeAsBytes(png!.buffer.asUint8List());
      });
    }

    Future<void> shot(String name) async {
      await settle();
      await capture(name);
      // ignore: avoid_print
      print('SHOT ${tag}_$name errors=${errors.length}');
    }

    /// Frames for [ms] of wall clock after an action (the animations run
    /// on the real clock here).
    Future<void> burst(String name, {int ms = 1100}) async {
      final watch = Stopwatch()..start();
      var i = 0;
      while (watch.elapsedMilliseconds < ms) {
        await tester.pump(const Duration(milliseconds: 16));
        await capture(
          '${name}_${(i++).toString().padLeft(2, '0')}'
          '_${watch.elapsedMilliseconds}ms',
          ratio: 0.4,
        );
      }
      // ignore: avoid_print
      print('BURST ${tag}_$name frames=$i');
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('locale', locale);
    await prefs.setString('theme_mode', theme);
    await prefs.remove('cart_lines_v2');

    app.main();
    await settle(20);
    await tester.runAsync(
      () => getIt<SessionCubit>().login('+213555000201', 'Jibli@2026'),
    );
    appRouter.go(Routes.home);
    await shot('01_home_top');

    final homeList = find.byType(Scrollable).first;
    final cardType = byTypeName('PremiumProductCard').evaluate().isNotEmpty ||
            !onlyHome
        ? 'PremiumProductCard'
        : 'ProductCard';
    // Down to the "Popular dishes" section.
    for (var i = 0; i < 12; i++) {
      await tester.drag(homeList, const Offset(0, -300));
      await settle(2);
      final cards = byTypeName(cardType).evaluate().toList();
      if (cards.length > 1) break;
      if (byTypeName('ProductCard').evaluate().length > 4) break;
    }
    await shot('02_dishes');
    await tester.drag(homeList, const Offset(0, -380));
    await shot('03_dishes_scrolled');
    await tester.drag(homeList, const Offset(0, -380));
    await shot('04_dishes_more');
    if (onlyHome) return;

    // + on a plain dish card (a filled round "+" button).
    final plus = find.descendant(
      of: byTypeName('PremiumProductCard'),
      matching: find.byIcon(Icons.add_rounded),
    );
    var tapped = false;
    for (var i = 0; i < 8 && !tapped; i++) {
      for (final e in plus.evaluate()) {
        final tooltip = e.findAncestorWidgetOfExactType<Tooltip>();
        final box = e.renderObject as RenderBox?;
        final y = box?.localToGlobal(Offset.zero).dy ?? -1;
        final h = tester.view.physicalSize.height / tester.view.devicePixelRatio;
        if (tooltip?.message != null &&
            !tooltip!.message!.contains('Choisir') &&
            !tooltip.message!.contains('اختر') &&
            y > 200 &&
            y < h - 180) {
          await tester.tapAt(box!.localToGlobal(box.size.center(Offset.zero)));
          tapped = true;
          break;
        }
      }
      if (!tapped) {
        await tester.drag(homeList, const Offset(0, -300));
        await settle(2);
      }
    }
    // ignore: avoid_print
    print('TAPPED plus on home: $tapped');
    await burst('05_flight_home');
    await shot('06_after_add');

    // Tap the visible part of a card photo: Hero into the product page.
    final screenH =
        tester.view.physicalSize.height / tester.view.devicePixelRatio;
    Finder? visibleCard;
    for (final e in byTypeName('PremiumProductCard').evaluate()) {
      final r = (e.renderObject! as RenderBox).paintBounds.shift(
        (e.renderObject! as RenderBox).localToGlobal(Offset.zero),
      );
      if (r.top > 220 && r.top < screenH - 500) {
        visibleCard = find.byWidget(e.widget);
        break;
      }
    }
    if (visibleCard == null) {
      await tester.drag(homeList, const Offset(0, -200));
      await settle(2);
      visibleCard = byTypeName('PremiumProductCard').last;
    }
    final rect = tester.getRect(visibleCard);
    await tester.tapAt(Offset(rect.center.dx, rect.top + 80));
    await burst('07_hero', ms: 450);
    await shot('08_product_from_card');
    // Add from the product page: flies from the add bar to the header icon.
    final addBtn = find.byKey(const ValueKey('customizer-add'));
    if (addBtn.evaluate().isNotEmpty) {
      await tester.tap(addBtn);
      await burst('08b_flight_product');
      await shot('08c_product_after');
    }
    appRouter.pop();
    await settle(4);
    appRouter.push(Routes.store(const String.fromEnvironment('STORE')));
    await shot('09_store');
    final rowPlus = find.descendant(
      of: byTypeName('StoreProductRow'),
      matching: find.byIcon(Icons.add_rounded),
    );
    if (rowPlus.evaluate().isNotEmpty) {
      await Scrollable.ensureVisible(
        tester.element(rowPlus.first),
        alignment: 0.6,
      );
      await settle(2);
      await tester.tap(rowPlus.first);
      await burst('10_flight_store');
      await settle(4);
      for (var i = 0; i < 3; i++) {
        if (rowPlus.evaluate().isEmpty) break;
        await tester.tap(rowPlus.first, warnIfMissed: false);
        await tester.pump(const Duration(milliseconds: 90));
      }
      await burst('11_triple', ms: 1300);
      await shot('12_store_after');
    }

    // Product with options → add.
    final customisable = find.byIcon(Icons.tune_rounded);
    if (customisable.evaluate().isNotEmpty) {
      await Scrollable.ensureVisible(
        tester.element(customisable.first),
        alignment: 0.5,
      );
      await settle(2);
      await tester.tap(customisable.first, warnIfMissed: false);
      await shot('13_product');
      // Pick the first radio (size) if any.
      final radios = find.byType(RadioGroup<String>);
      // ignore: avoid_print
      print('RADIOS ${radios.evaluate().length}');
      final add = find.byKey(const ValueKey('customizer-add'));
      final firstChoice = find.byWidgetPredicate(
        (w) => w.runtimeType.toString().contains('ChoiceTile'),
      );
      if (firstChoice.evaluate().isNotEmpty) {
        await tester.tap(firstChoice.first, warnIfMissed: false);
        await settle(2);
      }
      if (add.evaluate().isNotEmpty) {
        await tester.tap(add, warnIfMissed: false);
        await burst('14_flight_product');
        await shot('15_product_after');
      }
      appRouter.pop();
      await shot('16_back');
    }

    for (final e in errors.toSet()) {
      // ignore: avoid_print
      print('ERR $e');
    }
  });
}
