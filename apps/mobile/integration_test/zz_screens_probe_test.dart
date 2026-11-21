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
import 'package:orvynt_starter/features/catalog/ui/widgets/product_card.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/store_tile.dart';
import 'package:orvynt_starter/main.dart' as app;

const shots =
    '/private/tmp/claude-501/-Users-islamdebbi-coding-djibli-backend-and-dashboard/02cc32d7-ffa2-4f7d-bb1a-c9ff5da32ca7/scratchpad/shots';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('screens image probe', (tester) async {
    final failures = <String>[];
    final original = debugPrint;
    debugPrint = (String? m, {int? wrapWidth}) {
      if (m != null && m.startsWith('NetImage failed')) failures.add(m);
      original(m, wrapWidth: wrapWidth);
    };

    Future<void> settle([int seconds = 4]) async {
      for (var i = 0; i < seconds * 4; i++) {
        await tester.pump(const Duration(milliseconds: 250));
      }
    }

    Future<void> mark(String screen) async {
      await tester.runAsync(() async {
        final c = HttpClient();
        final r = await c.getUrl(
          Uri.parse('http://localhost:5001/api/v1/health?screen=$screen'),
        );
        await (await r.close()).drain<void>();
        c.close();
      });
    }

    Future<void> shot(String name) async {
      await settle();
      await tester.runAsync(() async {
        final boundary = binding.rootElement!.renderObject! as RenderView;
        final layer = boundary.debugLayer! as OffsetLayer;
        final image = await layer.toImage(
          Offset.zero & boundary.paintBounds.size,
          pixelRatio: 1,
        );
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('$shots/$name.png').writeAsBytes(png!.buffer.asUint8List());
      });
      // ignore: avoid_print
      print(
        'SHOT $name images=${find.byType(Image).evaluate().length} failures=${failures.length}',
      );
    }

    app.main();
    for (
      var i = 0;
      i < 40 &&
          find
              .textContaining(RegExp('guest', caseSensitive: false))
              .evaluate()
              .isEmpty;
      i++
    ) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    // Sign in as the seeded client so cart → orders work too.
    await tester.runAsync(
      () => getIt<SessionCubit>().login('+213555000201', 'Jibli@2026'),
    );
    await mark('home');
    appRouter.go(Routes.home);
    await shot('1_home');

    await mark('produce');
    appRouter.go(Routes.produce);
    await shot('2_produce');
    await mark('supermarket');
    appRouter.go(Routes.supermarket);
    await shot('3_supermarket');

    appRouter.go(Routes.home);
    await settle(2);
    await mark('product');
    await tester.tap(find.byType(ProductCard).first);
    await shot('4_product');
    appRouter.pop();
    await settle(1);

    await mark('store');
    await tester.scrollUntilVisible(
      find.byType(StoreTile).first,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byType(StoreTile).first);
    await shot('5_store');
    // add two items from the store page to the cart
    final adds = find.byTooltip('Add to cart');
    if (adds.evaluate().isNotEmpty) await tester.tap(adds.first);
    await settle(1);
    appRouter.pop();
    await settle(1);

    await mark('cart');
    appRouter.push(Routes.cart);
    await shot('6_cart');
    appRouter.pop();

    await mark('orders');
    appRouter.push(Routes.orders);
    await shot('7_orders');
    await mark('order');
    await tester.tap(find.textContaining('#').first);
    await shot('8_order');

    for (final f in failures) {
      // ignore: avoid_print
      print('FAIL $f');
    }
  });
}
