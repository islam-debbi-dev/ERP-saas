// Home feed scroll benchmark. Re-run it before every release.
//
// 1. Local API with seeded data on port 5001 (see README):
//      cd backend && PORT=5001 node src/server.js
// 2. A real Android phone (or a Pixel emulator with hardware graphics), in
//    profile mode, never debug:
//      cd mobile && flutter drive --profile \
//        --driver=test_driver/perf_driver.dart \
//        --target=integration_test/home_feed_scroll_perf_test.dart \
//        --dart-define=API_BASE_URL=http://10.0.2.2:5001/api/v1
//    (`10.0.2.2` is the host from the emulator; a phone on Wi-Fi uses the
//    Mac's LAN address, an iOS simulator `localhost`.)
//
// It opens home as a guest, waits for "Popular dishes", then three times
// flings down to the end of the feed (several page loads, and the random
// fast-food section after it) and back to the top. The driver prints the
// build / raster percentiles and the janky-frame share, and writes the
// timeline to `build/`.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:orvynt_starter/core/router/app_router.dart';
import 'package:orvynt_starter/core/router/routes.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/premium_product_card.dart';
import 'package:orvynt_starter/features/home/ui/home_tab_screen.dart';
import 'package:orvynt_starter/main.dart' as app;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // Real frames on the real clock, like a user's fling.
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('home feed: fling to the end and back, 3 times', (tester) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('locale', 'fr');
    await prefs.setBool('onboarding_seen', true);

    app.main();
    await _waitUntil(
      tester,
      () => find.byType(MaterialApp).evaluate().isNotEmpty,
    );
    appRouter.go(Routes.home);
    // The feed is in when its skeletons are gone (the dish cards themselves
    // start below the fold, so they are not built yet).
    await _waitUntil(
      tester,
      () =>
          find.byType(HomeFeedSections).evaluate().isNotEmpty &&
          find.byType(HomeFeedSkeleton).evaluate().isEmpty &&
          find
              .byType(PremiumProductCardSkeleton, skipOffstage: false)
              .evaluate()
              .isEmpty,
    );
    // Let the first images land, so the trace measures scrolling.
    await _idle(tester, const Duration(seconds: 2));

    // The feed itself (not the horizontal rows inside it).
    final scrollable = find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .first;
    ScrollPosition position() =>
        tester.state<ScrollableState>(scrollable).position;

    await binding.traceAction(() async {
      for (var round = 0; round < 3; round++) {
        // Down: fling until the list stops growing (no page left to load).
        var still = 0;
        for (var i = 0; i < 60 && still < 3; i++) {
          final before = position().maxScrollExtent;
          await tester.fling(scrollable, const Offset(0, -600), 3500);
          await _idle(tester, const Duration(milliseconds: 1200));
          final atEnd = position().extentAfter < 1;
          still = atEnd && position().maxScrollExtent == before ? still + 1 : 0;
        }
        // Up: back to the top.
        for (var i = 0; i < 60 && position().pixels > 0; i++) {
          await tester.fling(scrollable, const Offset(0, 600), 3500);
          await _idle(tester, const Duration(milliseconds: 1000));
        }
      }
    }, reportKey: 'home_feed_scroll');
  });
}

/// Pumps real frames until [done] (30 s max).
Future<void> _waitUntil(WidgetTester tester, bool Function() done) async {
  final watch = Stopwatch()..start();
  while (!done()) {
    if (watch.elapsed > const Duration(seconds: 30)) {
      fail('Timed out waiting for the home feed');
    }
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Lets real time pass while frames keep being produced.
Future<void> _idle(WidgetTester tester, Duration duration) async {
  final watch = Stopwatch()..start();
  while (watch.elapsed < duration) {
    await tester.pump(const Duration(milliseconds: 16));
  }
}
