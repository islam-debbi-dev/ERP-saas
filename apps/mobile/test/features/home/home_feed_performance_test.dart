import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orvynt_starter/core/components/widgets/net_image.dart';
import 'package:orvynt_starter/core/config/category_groups.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/models/app_config.dart';
import 'package:orvynt_starter/core/models/paginated.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/perf/app_perf.dart';
import 'package:orvynt_starter/core/service/api_result.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/theme/app_theme_dark.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/features/account/data/repo/account_repository.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/cart/ui/widgets/cart_flight.dart';
import 'package:orvynt_starter/features/catalog/data/models/home_feed.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/data/models/product_query.dart';
import 'package:orvynt_starter/features/catalog/data/repo/catalog_repository.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/premium_product_card.dart';
import 'package:orvynt_starter/features/home/logic/home_feed_cubit.dart';
import 'package:orvynt_starter/features/home/logic/random_products_cubit.dart';
import 'package:orvynt_starter/features/home/ui/home_tab_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../catalog/store_fixtures.dart';

Product _dish(
  String id, {
  String? description = 'Tomato, mozzarella and basil',
  num discount = 0,
  bool sized = false,
  bool storeOpen = true,
  String? image,
  String? createdAt,
  String name = '',
}) => Product.fromJson({
  'id': id,
  'storeId': 's1',
  'categoryId': 'c1',
  'name': name.isEmpty ? 'Dish $id' : name,
  'description': ?description,
  'price': 400,
  'discountPercentage': discount,
  'finalPrice': 400 - 400 * discount / 100,
  if (image != null)
    'images': [
      {'url': image},
    ],
  'createdAt': ?createdAt,
  if (sized) ...{
    'hasSizes': true,
    'requiresChoice': true,
    'priceFrom': 450,
    'finalPriceFrom': 450,
  },
  'store': {'id': 's1', 'name': 'Pizza Palace', 'isOpen': storeOpen},
});

List<Product> _dishes(String prefix, int n, {int from = 0}) => [
  for (var i = from; i < from + n; i++) _dish('$prefix$i'),
];

ApiResult<Paginated<Product>> _page(
  List<Product> items, {
  int page = 1,
  int totalPages = 1,
}) => ApiResult.success(
  Paginated(
    items: items,
    page: page,
    limit: 20,
    total: items.length * totalPages,
    totalPages: totalPages,
  ),
);

Future<void> _setUpView(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Widget _app({
  required Widget home,
  String locale = 'en',
  bool dark = false,
  double textScale = 1,
}) => MaterialApp(
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
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: app!,
  ),
  home: home,
);

/// One card, alone on a 360 px screen.
Future<void> _pumpCard(
  WidgetTester tester,
  Product product, {
  String locale = 'en',
  bool dark = false,
  double textScale = 1,
  DateTime? now,
}) async {
  await _setUpView(tester, const Size(360, 780));
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => _app(
          locale: locale,
          dark: dark,
          textScale: textScale,
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(20),
              children: [PremiumProductCard(product: product, now: now)],
            ),
          ),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.runAsync(() async {
    await tester.pumpWidget(
      BlocProvider<CartCubit>.value(
        value: CartCubit(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await tester.pump(const Duration(milliseconds: 300));
}

/// `/home` with a fast-food category (pizza) and a plain one (couscous);
/// popular dishes and the random fast food come from [popular] / [random].
class _FeedCatalog extends FakeCatalogRepository {
  _FeedCatalog({required this.popular, required this.random});

  final ApiResult<Paginated<Product>> Function(int page) popular;
  final ApiResult<Paginated<Product>> Function(int page) random;

  final productQueries = <ProductQuery>[];
  List<ProductQuery> get randomQueries => [
    for (final q in productQueries)
      if (q.randomSeed != null) q,
  ];

  @override
  Future<ApiResult<HomeFeed>> getHome({int? limit, String? group}) async =>
      ApiResult.success(
        HomeFeed.fromJson({
          'orderingEnabled': true,
          'categories': [
            {'id': 'c-pizza', 'name': 'Pizza', 'slug': 'pizza'},
            {'id': 'c-couscous', 'name': 'Couscous', 'slug': 'couscous'},
          ],
        }),
      );

  @override
  Future<ApiResult<AppConfig>> getAppConfig() async =>
      const ApiResult.success(AppConfig(orderingEnabled: true));

  @override
  Future<ApiResult<Paginated<Product>>> getProducts([
    ProductQuery query = const ProductQuery(),
  ]) async {
    productQueries.add(query);
    return query.randomSeed == null ? popular(query.page) : random(query.page);
  }
}

Future<void> _pumpHome(
  WidgetTester tester,
  CatalogRepository catalog, {
  Size size = const Size(360, 780),
}) async {
  await _setUpView(tester, size);
  final cart = CartCubit();
  getIt.allowReassignment = true;
  getIt.registerSingleton<CatalogRepository>(catalog);
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
          builder: (_, _) => _app(home: const HomeTabScreen()),
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await _settle(tester);
}

/// Lets the async fakes answer and the entrances finish (the screen has
/// endless animations, so no pumpAndSettle).
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump(const Duration(milliseconds: 300));
  }
}

/// Scrolls the home feed to its end, loading every page on the way.
Future<void> _scrollToEnd(WidgetTester tester) async {
  final list = find.byType(CustomScrollView).first;
  for (var i = 0; i < 40; i++) {
    final position = tester
        .state<ScrollableState>(
          find.descendant(of: list, matching: find.byType(Scrollable)).first,
        )
        .position;
    if (position.extentAfter < 1 && i > 2) break;
    await tester.drag(list, const Offset(0, -700));
    await _settle(tester);
  }
}

/// Tall enough for the whole short feed to stay built.
const _tall = Size(360, 4000);

Finder _inFastFood(Finder finder) => find.descendant(
  of: find.byKey(const ValueKey('fast-food-feed'), skipOffstage: false),
  matching: finder,
  skipOffstage: false,
);

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    CartFlight.reset();
    AppPerf.debugUseBlurOverride = null;
  });

  group('premium dish card', () {
    testWidgets('sale: final price, old price struck through, discount chip', (
      tester,
    ) async {
      await _pumpCard(tester, _dish('a', discount: 20));
      expect(find.text('-20%'), findsOneWidget);
      final old = tester.widget<Text>(find.textContaining('400'));
      expect(old.style?.decoration, TextDecoration.lineThrough);
      expect(find.textContaining('320'), findsOneWidget);
    });

    testWidgets('sizes: "from" price and the customisable chip; + opens the '
        'product instead of adding', (tester) async {
      await _pumpCard(tester, _dish('a', sized: true));
      expect(find.textContaining('From 450'), findsOneWidget);
      expect(find.text('Customisable'), findsOneWidget);
    });

    testWidgets('closed store: desaturated photo by its own filter, muted '
        'name, "Closed" on the store chip, no ColorFiltered', (tester) async {
      await _pumpCard(
        tester,
        _dish('a', storeOpen: false, image: '/uploads/a.jpg'),
      );
      expect(
        tester.widget<NetImage>(find.byType(NetImage).first).desaturate,
        isTrue,
      );
      expect(find.byType(ColorFiltered), findsNothing);
      expect(find.textContaining('Pizza Palace · Closed'), findsOneWidget);
    });

    testWidgets('no photo: the branded plate, not the grey fallback', (
      tester,
    ) async {
      await _pumpCard(tester, _dish('a'));
      expect(find.byKey(const ValueKey('dish-photo-fallback')), findsOneWidget);
      // The only network image left is the store logo.
      expect(find.byType(NetImage), findsOneWidget);
    });

    testWidgets('"New" for a dish added less than two weeks ago', (
      tester,
    ) async {
      final now = DateTime.utc(2026, 11, 18);
      await _pumpCard(
        tester,
        _dish('a', createdAt: '2026-11-10T10:00:00.000Z'),
        now: now,
      );
      expect(find.text('New'), findsOneWidget);
      await _pumpCard(
        tester,
        _dish('b', createdAt: '2026-10-01T10:00:00.000Z'),
        now: now,
      );
      expect(find.text('New'), findsNothing);
    });

    for (final dark in [false, true]) {
      testWidgets('RTL, long Arabic names, text 1.3${dark ? ', dark' : ''}: '
          'no overflow', (tester) async {
        await _pumpCard(
          tester,
          Product.fromJson({
            ..._dish(
              'a',
              discount: 15,
              sized: true,
              createdAt: DateTime.now().toIso8601String(),
              name: 'طبق مشوي على الفحم مع صلصة الثوم والبطاطا المقلية والسلطة',
            ).toJson(),
            'store': {
              'id': 's1',
              'name': 'مطعم الأصدقاء للمأكولات التقليدية والعصرية',
              'isOpen': false,
            },
          }),
          locale: 'ar',
          dark: dark,
          textScale: 1.3,
        );
        expect(tester.takeException(), isNull);
        expect(
          Directionality.of(tester.element(find.byType(PremiumProductCard))),
          TextDirection.rtl,
        );
      });
    }
  });

  group('home header surface', () {
    for (final blur in [false, true]) {
      testWidgets(
        blur
            ? 'grouped blur when the perf helper allows it'
            : 'solid surface, no BackdropFilter, when the perf helper says so',
        (tester) async {
          AppPerf.debugUseBlurOverride = blur;
          await _pumpHome(
            tester,
            _FeedCatalog(
              popular: (_) => _page(_dishes('p', 2)),
              random: (_) => _page(const []),
            ),
          );
          if (blur) {
            expect(
              find.byKey(const ValueKey('home-header-blur')),
              findsWidgets,
            );
            expect(find.byType(BackdropGroup), findsOneWidget);
          } else {
            expect(find.byType(BackdropFilter), findsNothing);
            expect(
              find.byKey(const ValueKey('home-header-solid')),
              findsNWidgets(2),
            );
          }
        },
      );
    }
  });

  group('random fast food after "Popular dishes"', () {
    testWidgets('starts only once the dishes reached their last page, with '
        'the fast-food categories only', (tester) async {
      final catalog = _FeedCatalog(
        popular: (page) => _page(
          _dishes('p', 3, from: (page - 1) * 3),
          page: page,
          totalPages: 2,
        ),
        random: (page) => _page(_dishes('f', 3), totalPages: 1),
      );
      await _pumpHome(tester, catalog, size: _tall);
      expect(catalog.randomQueries, isEmpty);
      expect(
        find.text('More fast food for you', skipOffstage: false),
        findsNothing,
      );

      await _scrollToEnd(tester);
      expect(catalog.randomQueries, isNotEmpty);
      expect(catalog.randomQueries.first.categoryIds, ['c-pizza']);
      expect(
        find.text('More fast food for you', skipOffstage: false),
        findsOneWidget,
      );
      expect(_inFastFood(find.byType(PremiumProductCard)), findsNWidgets(3));
    });

    testWidgets('hidden when the random query finds nothing', (tester) async {
      final catalog = _FeedCatalog(
        popular: (_) => _page(_dishes('p', 3)),
        random: (_) => _page(const []),
      );
      await _pumpHome(tester, catalog);
      await _scrollToEnd(tester);
      expect(catalog.randomQueries, hasLength(1));
      expect(
        find.text('More fast food for you', skipOffstage: false),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('fast-food-feed'), skipOffstage: false),
        findsOneWidget,
      );
      expect(_inFastFood(find.byType(PremiumProductCard)), findsNothing);
    });

    testWidgets('not shown when "Popular dishes" is empty', (tester) async {
      final catalog = _FeedCatalog(
        popular: (_) => _page(const []),
        random: (_) => _page(_dishes('f', 3)),
      );
      await _pumpHome(tester, catalog);
      await _scrollToEnd(tester);
      expect(find.text('No dishes yet'), findsOneWidget);
      expect(catalog.randomQueries, isEmpty);
      expect(
        find.text('More fast food for you', skipOffstage: false),
        findsNothing,
      );
    });

    testWidgets('a dish never shows twice inside the random section, and '
        'it loads page after page with the same seed', (tester) async {
      final catalog = _FeedCatalog(
        popular: (_) => _page([_dish('f1'), _dish('p0')]),
        // Page 2 repeats f2 (e.g. a product moved between two requests).
        random: (page) => page == 1
            ? _page([_dish('f1'), _dish('f2')], totalPages: 2)
            : _page([_dish('f2'), _dish('f3')], page: 2, totalPages: 2),
      );
      await _pumpHome(tester, catalog, size: _tall);
      await _scrollToEnd(tester);
      expect(catalog.randomQueries.map((q) => q.page), [1, 2]);
      expect(
        catalog.randomQueries.map((q) => q.randomSeed).toSet(),
        hasLength(1),
      );
      expect(_inFastFood(find.text('Dish f2')), findsOneWidget);
      expect(_inFastFood(find.text('Dish f3')), findsOneWidget);
      // f1 is also in "Popular dishes" (expected): its random card has no
      // Hero, so the two never share a tag.
      expect(_inFastFood(find.text('Dish f1')), findsOneWidget);
      expect(
        tester
            .widget<PremiumProductCard>(
              _inFastFood(find.byType(PremiumProductCard)).first,
            )
            .hero,
        isFalse,
      );
    });

    testWidgets('pull-to-refresh resets both lists and reshuffles with a new '
        'seed', (tester) async {
      final catalog = _FeedCatalog(
        popular: (_) => _page(_dishes('p', 2)),
        random: (_) => _page(_dishes('f', 2)),
      );
      await _pumpHome(tester, catalog);
      await _scrollToEnd(tester);
      final first = catalog.randomQueries.single.randomSeed;

      final context = tester.element(
        find.byType(CustomScrollView, skipOffstage: false).first,
      );
      await tester.runAsync(context.read<HomeFeedCubit>().load);
      await _settle(tester);
      await _scrollToEnd(tester);
      expect(catalog.randomQueries, hasLength(2));
      expect(catalog.randomQueries.last.randomSeed, isNot(first));
    });
  });

  group('RandomProductsCubit', () {
    test(
      'a run keeps one seed for all its pages; a new run reshuffles',
      () async {
        final catalog = _FeedCatalog(
          popular: (_) => _page(const []),
          random: (page) =>
              _page(_dishes('f', 2, from: page * 2), page: page, totalPages: 2),
        );
        final cubit = RandomProductsCubit(catalog, random: Random(7));
        addTearDown(cubit.close);
        expect(cubit.started, isFalse);

        await cubit.start(['c-pizza']);
        await cubit.loadMore();
        expect(cubit.state.items, hasLength(4));
        expect(cubit.state.hasMore, isFalse);
        final seeds = catalog.randomQueries.map((q) => q.randomSeed).toSet();
        expect(seeds, hasLength(1));
        expect(
          catalog.randomQueries.first.toQuery()['randomSeed'],
          seeds.single,
        );

        cubit.clear();
        expect(cubit.started, isFalse);
        expect(cubit.state.items, isEmpty);
        await cubit.start(['c-pizza']);
        expect(catalog.randomQueries.last.randomSeed, isNot(seeds.single));
      },
    );

    test('randomSeed is only sent when set', () {
      expect(const ProductQuery().toQuery().containsKey('randomSeed'), isFalse);
    });

    test('fast food is one list, at the head of the food group', () {
      expect(CategoryGroup.fastFood, [
        'burger',
        'pizza',
        'tacos',
        'sandwich',
        'fried-chicken',
        'wraps',
        'hot-dog',
      ]);
      expect(
        CategoryGroup.food.slugs.take(CategoryGroup.fastFood.length),
        CategoryGroup.fastFood,
      );
      final state = HomeFeedState(
        feed: HomeFeed.fromJson({
          'orderingEnabled': true,
          'categories': [
            {'id': 'a', 'name': 'Burger', 'slug': 'burger'},
            {'id': 'b', 'name': 'Soup', 'slug': 'soup'},
          ],
        }),
      );
      expect(state.fastFoodCategoryIds, ['a']);
    });
  });
}
