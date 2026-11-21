import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/models/app_config.dart';
import 'package:orvynt_starter/core/models/paginated.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/paging/paged_cubit.dart';
import 'package:orvynt_starter/core/service/api_result.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/theme/app_theme_dark.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/features/account/data/repo/account_repository.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/cart/ui/widgets/cart_flight.dart';
import 'package:orvynt_starter/features/cart/ui/widgets/cart_icon_button.dart';
import 'package:orvynt_starter/features/catalog/data/models/home_feed.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/data/models/product_query.dart';
import 'package:orvynt_starter/features/catalog/data/repo/catalog_repository.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/paged_product_slivers.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/premium_product_card.dart';
import 'package:orvynt_starter/features/home/ui/home_tab_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../catalog/app_harness.dart';
import '../catalog/store_fixtures.dart';

Product _dish(
  String id, {
  String? description = 'Tomato, mozzarella and basil',
  num discount = 0,
  bool available = true,
  bool sized = false,
}) => Product.fromJson({
  'id': id,
  'storeId': 's1',
  'categoryId': 'c1',
  'name': 'Dish $id',
  'description': ?description,
  'price': 400,
  'discountPercentage': discount,
  'finalPrice': 400 - 400 * discount / 100,
  'isAvailable': available,
  if (sized) ...{
    'hasSizes': true,
    'requiresChoice': true,
    'priceFrom': 300,
    'finalPriceFrom': 300,
  },
  'store': {'id': 's1', 'name': 'Pizza Palace', 'isOpen': true},
});

List<Product> _dishes(int n, {int from = 0}) => [
  for (var i = from; i < from + n; i++) _dish('d$i'),
];

Future<ApiResult<Paginated<Product>>> _page(
  List<Product> items, {
  int page = 1,
  int totalPages = 1,
}) async => ApiResult.success(
  Paginated(
    items: items,
    page: page,
    limit: 20,
    total: items.length * totalPages,
    totalPages: totalPages,
  ),
);

/// The "Popular dishes" sliver alone, under an app bar with the cart icon,
/// with a router so the product page can open.
Future<PagedCubit<Product>> _pumpFeed(
  WidgetTester tester, {
  required PageFetcher<Product> fetch,
  CartCubit? cart,
  String locale = 'en',
  Size size = const Size(360, 780),
  double textScale = 1,
  bool reduceMotion = false,
  bool dark = false,
  bool load = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final paged = PagedCubit<Product>(fetch);
  addTearDown(paged.close);
  if (load) unawaited(paged.refresh());
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => Scaffold(
          appBar: AppBar(actions: const [CartIconButton()]),
          body: BlocBuilder<PagedCubit<Product>, PagedState<Product>>(
            builder: (context, state) => LoadMoreListener(
              onLoadMore: paged.loadMore,
              child: CustomScrollView(
                slivers: [
                  PagedProductList(
                    state: state,
                    onRetry: paged.refresh,
                    onLoadMore: paged.loadMore,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/product/:id',
        builder: (_, s) =>
            Scaffold(body: Text('product page ${s.pathParameters['id']}')),
      ),
      GoRoute(
        path: '/store/:id',
        builder: (_, s) => const Scaffold(body: Text('store page')),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.runAsync(() async {
    await tester.pumpWidget(
      MultiBlocProvider(
        providers: [
          BlocProvider<CartCubit>.value(value: cart ?? CartCubit()),
          BlocProvider.value(value: paged),
        ],
        child: MaterialApp.router(
          theme: dark ? appThemeDark : appThemeLight,
          locale: Locale(locale),
          supportedLocales: const [Locale('en'), Locale('ar'), Locale('fr')],
          localizationsDelegates: const [
            AppLocalizationsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (context, app) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(textScale),
              disableAnimations: reduceMotion,
            ),
            child: app!,
          ),
          routerConfig: router,
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  return paged;
}

/// Catalog whose `/home` lists one food category and whose products are
/// the "Popular dishes".
class _HomeCatalog extends FakeCatalogRepository {
  _HomeCatalog(this.dishes);

  final List<Product> dishes;

  @override
  Future<ApiResult<HomeFeed>> getHome({int? limit, String? group}) async =>
      ApiResult.success(
        HomeFeed.fromJson({
          'orderingEnabled': true,
          'categories': [
            {'id': 'c1', 'name': 'Pizza', 'slug': 'pizza'},
          ],
        }),
      );

  @override
  Future<ApiResult<AppConfig>> getAppConfig() async =>
      const ApiResult.success(AppConfig(orderingEnabled: true));

  @override
  Future<ApiResult<Paginated<Product>>> getProducts([
    ProductQuery query = const ProductQuery(),
  ]) => _page(dishes);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    CartFlight.reset();
  });

  group('home "Popular dishes"', () {
    Future<void> pumpHome(WidgetTester tester, Size size) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final cart = CartCubit();
      getIt.allowReassignment = true;
      getIt.registerSingleton<CatalogRepository>(_HomeCatalog(_dishes(4)));
      getIt.registerSingleton<CartCubit>(cart);
      final client = ApiClient(dio: Dio());
      final session = SessionCubit(
        AuthRepository(client),
        AccountRepository(client),
      );
      addTearDown(session.close);
      await tester.runAsync(() async {
        await tester.pumpWidget(
          MultiBlocProvider(
            providers: [
              BlocProvider<CartCubit>.value(value: cart),
              BlocProvider<SessionCubit>.value(value: session),
            ],
            child: ScreenUtilInit(
              designSize: const Size(375, 812),
              builder: (_, _) => MaterialApp(
                theme: appThemeLight,
                locale: const Locale('en'),
                supportedLocales: const [
                  Locale('en'),
                  Locale('ar'),
                  Locale('fr'),
                ],
                localizationsDelegates: const [
                  AppLocalizationsDelegate(),
                  GlobalMaterialLocalizations.delegate,
                  GlobalWidgetsLocalizations.delegate,
                  GlobalCupertinoLocalizations.delegate,
                ],
                home: const HomeTabScreen(),
              ),
            ),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 300));
      });
      await tester.pump(const Duration(milliseconds: 600));
    }

    testWidgets('renders premium cards in one column at 360 px', (
      tester,
    ) async {
      await pumpHome(tester, const Size(360, 780));
      for (
        var i = 0;
        i < 6 && find.byType(PremiumProductCard).evaluate().isEmpty;
        i++
      ) {
        await tester.drag(
          find.byType(CustomScrollView).first,
          const Offset(0, -300),
        );
        await tester.pump(const Duration(milliseconds: 400));
      }
      final cards = find.byType(PremiumProductCard);
      expect(cards, findsWidgets);
      final first = tester.getRect(cards.at(0));
      expect(first.width, closeTo(360 - 40, 0.5));
      await tester.pump(const Duration(seconds: 2));
    });
  });

  group('PagedProductList', () {
    testWidgets('one column at 360 px, two from 600 px', (tester) async {
      await _pumpFeed(tester, fetch: (_) => _page(_dishes(4)));
      await tester.pumpAndSettle();
      var a = tester.getRect(find.byType(PremiumProductCard).at(0));
      var b = tester.getRect(find.byType(PremiumProductCard).at(1));
      expect(a.left, b.left);
      expect(b.top, greaterThan(a.bottom));
      // One card and the top of the next show on the phone.
      expect(b.top - a.bottom, PagedProductList.gap);

      await _pumpFeed(
        tester,
        size: const Size(820, 1000),
        fetch: (_) => _page(_dishes(4)),
      );
      await tester.pumpAndSettle();
      a = tester.getRect(find.byType(PremiumProductCard).at(0));
      b = tester.getRect(find.byType(PremiumProductCard).at(1));
      expect(a.top, b.top);
      expect(a.width, lessThanOrEqualTo(PremiumProductCard.maxWidth));
    });

    testWidgets('a card shows name, store, price, discount and the '
        'unavailable state', (tester) async {
      await _pumpFeed(
        tester,
        fetch: (_) => _page([
          _dish('a', discount: 25),
          _dish('b', sized: true),
          _dish('c', available: false, description: null),
        ]),
      );
      await tester.pumpAndSettle();
      expect(find.text('Dish a'), findsOneWidget);
      expect(find.text('Pizza Palace'), findsWidgets);
      expect(find.text('-25%'), findsOneWidget);
      expect(textContaining('300'), findsWidgets);
      await tester.scrollUntilVisible(find.text('Dish c'), 300);
      await tester.pumpAndSettle();
      expect(textContaining('From 300'), findsOneWidget);
      expect(find.text('Unavailable'), findsOneWidget);
    });

    testWidgets('+ on a plain dish adds it with a flight; + on a sized '
        'dish opens the product', (tester) async {
      final cart = CartCubit();
      await _pumpFeed(
        tester,
        cart: cart,
        fetch: (_) => _page([_dish('a'), _dish('b', sized: true)]),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.add_rounded).first);
      await tester.pump();
      expect(cart.state.lineCount, 1);
      expect(find.byType(CartFlightThumb), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.byType(CartFlightThumb), findsNothing);

      final sizedPlus = find.descendant(
        of: find.ancestor(
          of: find.text('Dish b'),
          matching: find.byType(PremiumProductCard),
        ),
        matching: find.byIcon(Icons.add_rounded),
      );
      await tester.scrollUntilVisible(sizedPlus, 300);
      await tester.pumpAndSettle();
      await tester.tap(sizedPlus);
      await tester.pumpAndSettle();
      expect(find.text('product page b'), findsOneWidget);
      expect(cart.state.lineCount, 1);
    });

    testWidgets('tapping a card opens the product page', (tester) async {
      await _pumpFeed(tester, fetch: (_) => _page([_dish('a')]));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Dish a'));
      await tester.pumpAndSettle();
      expect(find.text('product page a'), findsOneWidget);
    });

    /// Entrance progress of a card: 0 hidden, 1 revealed.
    double opacityOf(WidgetTester tester, String id) =>
        RevealOnScroll.progressOf(
          tester.state(find.byKey(ValueKey('reveal-$id'), skipOffstage: false)),
        );

    testWidgets('the entrance plays once per card', (tester) async {
      await _pumpFeed(tester, fetch: (_) => _page(_dishes(12)));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pump(const Duration(milliseconds: 80));
      expect(opacityOf(tester, 'd0'), inExclusiveRange(0, 1));
      await tester.pumpAndSettle();
      expect(opacityOf(tester, 'd0'), 1);

      // Far down and back: d0 is rebuilt but does not replay.
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -3000));
      await tester.pumpAndSettle();
      await tester.drag(find.byType(CustomScrollView), const Offset(0, 6000));
      await tester.pump();
      expect(opacityOf(tester, 'd0'), 1);
      await tester.pumpAndSettle();
    });

    testWidgets('a card built below the screen waits until it is painted', (
      tester,
    ) async {
      await _pumpFeed(tester, fetch: (_) => _page(_dishes(12)));
      await tester.pumpAndSettle();
      // d2 is laid out in the cache extent (not on screen): still hidden.
      expect(
        find.byKey(const ValueKey('reveal-d2'), skipOffstage: false),
        findsOneWidget,
      );
      expect(opacityOf(tester, 'd2'), 0);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pump(const Duration(milliseconds: 60));
      expect(opacityOf(tester, 'd2'), inExclusiveRange(0, 1));
      await tester.pumpAndSettle();
      expect(opacityOf(tester, 'd2'), 1);
    });

    testWidgets('revealed cards leave no opacity or transform layer', (
      tester,
    ) async {
      await _pumpFeed(tester, fetch: (_) => _page(_dishes(3)));
      await tester.pumpAndSettle();
      expect(opacityOf(tester, 'd0'), 1);
      final layers = tester.layers;
      expect(layers.whereType<OpacityLayer>(), isEmpty);
      // Only the root transform of the view.
      expect(layers.whereType<TransformLayer>(), hasLength(1));
    });

    testWidgets('no entrance with Reduce Motion', (tester) async {
      await _pumpFeed(
        tester,
        reduceMotion: true,
        fetch: (_) => _page(_dishes(3)),
      );
      await tester.pump();
      expect(opacityOf(tester, 'd0'), 1);
      await tester.pump(const Duration(milliseconds: 16));
      expect(opacityOf(tester, 'd0'), 1);
      await tester.pumpAndSettle();
    });

    testWidgets('appending a page does not rebuild the cards already built', (
      tester,
    ) async {
      final paged = await _pumpFeed(
        tester,
        fetch: (page) => page == 1
            ? _page(_dishes(3), totalPages: 2)
            : _page(_dishes(3, from: 20), page: 2, totalPages: 2),
      );
      await tester.pumpAndSettle();
      PremiumProductCard.debugBuildCounts.clear();

      await tester.runAsync(paged.loadMore);
      await tester.pump();
      await tester.pumpAndSettle();
      expect(paged.state.items, hasLength(6));
      final counts = PremiumProductCard.debugBuildCounts;
      for (final id in ['d0', 'd1', 'd2']) {
        expect(counts[id], isNull, reason: '$id was rebuilt');
      }
    });

    testWidgets('loading shows the premium skeleton, then loading more '
        'appends cards', (tester) async {
      final first = Completer<ApiResult<Paginated<Product>>>();
      final paged = await _pumpFeed(
        tester,
        load: false,
        fetch: (page) => page == 1
            ? first.future
            : _page(_dishes(3, from: 20), page: 2, totalPages: 2),
      );
      unawaited(paged.refresh());
      await tester.pump();
      expect(find.byType(PremiumProductCardSkeleton), findsNWidgets(2));

      first.complete(_page(_dishes(3), totalPages: 2));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(PremiumProductCardSkeleton), findsNothing);
      expect(paged.state.items, hasLength(3));

      // The list is short: scrolling to the end asks for page 2.
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -2000));
      await tester.pumpAndSettle();
      expect(paged.state.items, hasLength(6));
      await tester.scrollUntilVisible(find.text('Dish d22'), 300);
      expect(find.text('Dish d22'), findsOneWidget);
    });

    for (final dark in [false, true]) {
      testWidgets('ar at 360 px, text 1.3${dark ? ', dark' : ''}: no '
          'overflow', (tester) async {
        await _pumpFeed(
          tester,
          locale: 'ar',
          textScale: 1.3,
          dark: dark,
          fetch: (_) => _page([
            _dish('a', discount: 10, sized: true),
            Product.fromJson({
              ..._dish('long').toJson(),
              'name':
                  'طبق مشوي على الفحم مع صلصة الثوم والبطاطا المقلية والسلطة',
              'store': {
                'id': 's1',
                'name': 'مطعم الأصدقاء للمأكولات التقليدية والعصرية',
                'isOpen': false,
              },
            }),
          ]),
        );
        await tester.pumpAndSettle();
        await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
