import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/features/cart/data/models/cart_line.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/cart/ui/cart_screen.dart';
import 'package:orvynt_starter/features/catalog/data/repo/catalog_repository.dart';
import 'package:orvynt_starter/features/catalog/ui/product_details_screen.dart';
import 'package:orvynt_starter/features/catalog/ui/store_details_screen.dart';

import 'store_fixtures.dart';

/// Pumps the store / product / cart routes on a phone-sized view (360 px by
/// default) with the real locale files and a [FakeCatalogRepository].
Future<void> pumpCatalogApp(
  WidgetTester tester, {
  required String location,
  required FakeCatalogRepository repository,
  required CartCubit cart,
  String locale = 'en',
  Size size = const Size(360, 780),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  getIt.allowReassignment = true;
  getIt.registerSingleton<CatalogRepository>(repository);

  final router = GoRouter(
    initialLocation: location,
    routes: [
      GoRoute(
        path: '/store/:id',
        builder: (_, s) => StoreDetailsScreen(storeId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/product/:id',
        builder: (_, s) => ProductDetailsScreen(
          productId: s.pathParameters['id']!,
          editLine: s.extra as CartLine?,
        ),
      ),
      GoRoute(path: '/cart', builder: (_, _) => const CartScreen()),
    ],
  );
  addTearDown(router.dispose);

  // The locale JSON is read from the asset bundle with real I/O.
  await tester.runAsync(() async {
    await tester.pumpWidget(
      BlocProvider<CartCubit>.value(
        value: cart,
        child: MaterialApp.router(
          theme: appThemeLight,
          locale: Locale(locale),
          supportedLocales: const [Locale('en'), Locale('ar'), Locale('fr')],
          localizationsDelegates: const [
            AppLocalizationsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          routerConfig: router,
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await tester.pumpAndSettle();
}

/// Text finder that ignores the narrow no-break space `formatDzd` uses.
Finder textContaining(String pattern) => find.byWidgetPredicate(
  (w) => w is Text && (w.data ?? '').replaceAll(' ', ' ').contains(pattern),
);

/// Lets the snackbar / "added" timers run out before the test ends.
Future<void> settleTimers(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 3));
  await tester.pumpAndSettle();
}
