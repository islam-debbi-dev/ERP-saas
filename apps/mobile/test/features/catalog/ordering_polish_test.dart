import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/components/widgets/net_image.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/theme/app_theme_dark.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/catalog/data/models/home_feed.dart';
import 'package:orvynt_starter/features/catalog/data/models/store.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_category_bar.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_header.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_product_row.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/store_tile.dart';
import 'package:orvynt_starter/features/home/logic/home_feed_cubit.dart';
import 'package:orvynt_starter/features/home/ui/home_tab_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_harness.dart';
import 'store_fixtures.dart';

/// Pumps [child] alone with the real locale files, a [CartCubit] and a
/// phone-sized view (360 px by default).
Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  String locale = 'en',
  Size size = const Size(360, 780),
  double textScale = 1,
  bool dark = false,
  CartCubit? cart,
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.runAsync(() async {
    await tester.pumpWidget(
      BlocProvider<CartCubit>.value(
        value: cart ?? CartCubit(),
        child: MaterialApp(
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
          home: Scaffold(body: child),
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  // Shimmers and image placeholders loop forever: pump a fixed time.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump(const Duration(milliseconds: 500));
  }
}

Store _store({
  bool isOpen = true,
  String name = 'Pizza Palace',
  String? cover,
}) => Store.fromJson({
  'id': 's1',
  'name': name,
  'cover': ?cover,
  'address': 'Oran',
  'isOpen': isOpen,
  'categoryIds': ['c1'],
  'openingHours': [
    for (var d = 0; d < 7; d++) {'day': d, 'open': '18:00', 'close': '23:30'},
  ],
});

/// Mid-afternoon, before the 18:00 opening of [_store].
final _afternoon = DateTime(2026, 11, 17, 15);

Finder _largeTitle(String name) => find.byWidgetPredicate(
  (w) => w is Text && w.data == name && w.style?.fontSize == 28,
);

double _opacityAbove(WidgetTester tester, Finder finder) => tester
    .widget<Opacity>(
      find.ancestor(of: finder, matching: find.byType(Opacity)).first,
    )
    .opacity;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('A. product page header', () {
    testWidgets('large title sits on the sheet over the photo; the compact '
        'title appears after scrolling', (tester) async {
      await pumpCatalogApp(
        tester,
        location: '/product/p2',
        repository: FakeCatalogRepository(),
        cart: CartCubit(),
      );

      // No photo: the branded placeholder, never an empty box.
      expect(find.byKey(const ValueKey('photo-placeholder')), findsOneWidget);
      expect(_largeTitle('Margherita'), findsOneWidget);
      // No empty band: the title starts right under the sheet's edge
      // (only the store chip in between).
      final photoBottom = tester
          .getBottomLeft(find.byKey(const ValueKey('photo-placeholder')))
          .dy;
      final titleTop = tester.getTopLeft(_largeTitle('Margherita')).dy;
      expect(titleTop - photoBottom, lessThan(60));
      expect(find.byKey(const ValueKey('store-chip')), findsOneWidget);

      expect(tester.takeException(), isNull);
    });

    testWidgets('the compact title fades in once the large one scrolled '
        'under the bar', (tester) async {
      await pumpCatalogApp(
        tester,
        location: '/product/a1',
        repository: FakeCatalogRepository(),
        cart: CartCubit(),
      );
      final compact = find.byKey(const ValueKey('compact-title'));
      expect(_opacityAbove(tester, compact), 0);
      expect(_largeTitle('Assiette creuse'), findsOneWidget);

      await tester.drag(find.byType(CustomScrollView), const Offset(0, -700));
      await tester.pumpAndSettle();
      expect(_opacityAbove(tester, compact), 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long Arabic name wraps in the large title and ellipsizes '
        'in the compact one, at 360 px', (tester) async {
      const longName =
          'بيتزا عائلية كبيرة بالجبن الذائب والزيتون والفطر والفلفل الأخضر';
      await pumpCatalogApp(
        tester,
        location: '/product/x1',
        repository: FakeCatalogRepository(
          products: {
            null: [plain('x1', longName, 'pizzas')],
          },
        ),
        cart: CartCubit(),
        locale: 'ar',
      );
      expect(tester.takeException(), isNull);
      final large = tester.widget<Text>(_largeTitle(longName));
      expect(large.maxLines, greaterThanOrEqualTo(2));
      expect(tester.getSize(_largeTitle(longName)).height, greaterThan(40));
      final compact = tester.widget<Text>(
        find.byKey(const ValueKey('compact-title')),
      );
      expect(compact.maxLines, 1);
      expect(compact.overflow, TextOverflow.ellipsis);
    });
  });

  group('B. store page', () {
    testWidgets('the header has no Call pill', (tester) async {
      await _pump(tester, StoreHeader(store: restaurant(), now: _afternoon));
      expect(find.text('Call'), findsNothing);
      expect(find.byIcon(Icons.call_rounded), findsNothing);
      // The info button (the phone lives in its sheet) is still there.
      expect(find.byTooltip('Store info'), findsOneWidget);
    });

    testWidgets('category tiles fall back from image to icon to monogram', (
      tester,
    ) async {
      const categories = [
        StoreMenuCategory(
          id: 'a',
          name: 'Pizzas',
          image: 'https://example.com/pizza.webp',
          productCount: 3,
        ),
        StoreMenuCategory(
          id: 'b',
          name: 'Burgers',
          icon: '🍔',
          productCount: 2,
        ),
        StoreMenuCategory(id: 'c', name: 'Tacos', productCount: 1),
      ];
      String? selected;
      await _pump(
        tester,
        StatefulBuilder(
          builder: (context, setState) => SizedBox(
            height: StoreCategoryBarDelegate.baseHeight,
            child: StoreCategoryBar(
              categories: categories,
              total: 6,
              selectedId: selected,
              onSelect: (id) => setState(() => selected = id),
            ),
          ),
        ),
        settle: false,
      );
      final tiles = tester
          .widgetList<CategoryTile>(find.byType(CategoryTile))
          .toList();
      expect(tiles.map((t) => t.visual), [
        CategoryTileVisual.all,
        CategoryTileVisual.image,
        CategoryTileVisual.icon,
        CategoryTileVisual.monogram,
      ]);
      expect(find.byKey(const ValueKey('tile-monogram')), findsOneWidget);
      expect(find.text('T'), findsOneWidget);
      expect(find.text('🍔'), findsOneWidget);
      expect(find.text('6'), findsOneWidget); // "All" count badge

      await tester.tap(find.text('Tacos'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(selected, 'c');
      expect(
        tester
            .widget<CategoryTile>(find.byKey(const ValueKey('category-tile-c')))
            .selected,
        isTrue,
      );
    });

    testWidgets('selecting a tile shows only that section; a swipe moves to '
        'the next one', (tester) async {
      await pumpCatalogApp(
        tester,
        location: '/store/s1',
        repository: FakeCatalogRepository(),
        cart: CartCubit(),
        size: const Size(360, 1800),
      );
      expect(find.byType(StoreProductRow), findsNWidgets(4));
      await tester.tap(find.byKey(const ValueKey('category-tile-pizzas')));
      await tester.pumpAndSettle();
      expect(find.byType(StoreProductRow), findsNWidgets(2));
      expect(find.text('Hamoud'), findsNothing);

      // Swipe towards the start in LTR: next section (Assiettes).
      await tester.fling(
        find.byType(StoreProductRow).first,
        const Offset(-300, 0),
        1000,
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<StoreCategoryBar>(find.byType(StoreCategoryBar))
            .selectedId,
        'plates',
      );
      expect(find.byType(StoreProductRow), findsOneWidget);
      expect(find.text('Assiette creuse'), findsOneWidget);
    });
  });

  group('C. premium store card', () {
    testWidgets('shows the name, category · address and the open status', (
      tester,
    ) async {
      await _pump(
        tester,
        Center(
          child: StoreTile(
            store: _store(cover: '/uploads/cover.jpg'),
            categoryName: 'Pizza',
            now: _afternoon,
          ),
        ),
        settle: false,
      );
      expect(find.text('Pizza Palace'), findsOneWidget);
      expect(find.text('Pizza · Oran'), findsOneWidget);
      expect(find.text('Open'), findsOneWidget);
      expect(
        tester.widget<NetImage>(find.byType(NetImage).first).desaturate,
        isFalse,
      );
      expect(
        tester.getSize(find.byType(StoreTile)),
        const Size(StoreTile.rowWidth, StoreTile.rowHeight),
      );
    });

    testWidgets('a closed store says when it opens and is desaturated', (
      tester,
    ) async {
      await _pump(
        tester,
        Center(
          child: StoreTile(
            store: _store(isOpen: false, cover: '/uploads/cover.jpg'),
            now: _afternoon,
          ),
        ),
        settle: false,
      );
      expect(find.text('Opens at 18:00'), findsOneWidget);
      // Desaturated by the cover's own colour filter, not a saveLayer.
      expect(find.byType(ColorFiltered), findsNothing);
      expect(
        tester.widget<NetImage>(find.byType(NetImage).first).desaturate,
        isTrue,
      );
    });

    for (final dark in [false, true]) {
      testWidgets('list card in ar at 360 px, text 1.3, '
          '${dark ? 'dark' : 'light'}, without overflow', (tester) async {
        await _pump(
          tester,
          ListView(
            padding: const EdgeInsets.all(20),
            children: [
              StoreTile(
                store: _store(
                  name: 'مطعم البيتزا الإيطالية الأصلية في وسط المدينة',
                  isOpen: false,
                ),
                size: StoreTileSize.list,
                categoryName: 'بيتزا',
                now: _afternoon,
              ),
              const SizedBox(height: 20),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: StoreTile(store: _store(), now: _afternoon),
              ),
            ],
          ),
          locale: 'ar',
          textScale: 1.3,
          dark: dark,
        );
        expect(tester.takeException(), isNull);
        // 16:10 at 320 pt wide.
        expect(tester.getSize(find.byType(StoreTile).first).height, 200);
      });
    }
  });

  group('D. home feed order', () {
    HomeFeed feed() => HomeFeed.fromJson({
      'orderingEnabled': true,
      'categories': [
        {'id': 'c1', 'name': 'Pizza', 'slug': 'pizza'},
      ],
      'featuredProducts': [
        {
          'id': 'p1',
          'storeId': 's1',
          'categoryId': 'c1',
          'name': 'Margherita',
          'price': 300,
          'finalPrice': 300,
        },
      ],
      'featuredKind': 'new',
      'stores': [
        {
          'id': 's1',
          'name': 'Pizza Palace',
          'isOpen': true,
          'categoryIds': ['c1'],
        },
      ],
    });

    testWidgets('stores come before new products', (tester) async {
      await _pump(
        tester,
        CustomScrollView(
          slivers: [
            HomeFeedSections(
              state: HomeFeedState(feed: feed(), loading: false),
            ),
          ],
        ),
        size: const Size(360, 1400),
      );
      expect(tester.takeException(), isNull);
      final stores = tester.getTopLeft(find.text('Restaurants')).dy;
      final products = tester.getTopLeft(find.text('New')).dy;
      expect(stores, lessThan(products));
      expect(find.byType(StoreTile), findsOneWidget);
      // The card's subtitle uses the feed's category name.
      expect(find.text('Pizza'), findsWidgets);
    });

    testWidgets('the skeleton has the same order', (tester) async {
      await _pump(
        tester,
        const SingleChildScrollView(child: HomeFeedSkeleton()),
        size: const Size(360, 1400),
        settle: false,
      );
      final stores = tester
          .getTopLeft(find.byKey(const ValueKey('skeleton-stores')))
          .dy;
      final products = tester
          .getTopLeft(find.byKey(const ValueKey('skeleton-products')))
          .dy;
      expect(stores, lessThan(products));
      expect(find.byType(StoreTileSkeleton), findsWidgets);
    });

    testWidgets('renders in ar at 360 px without overflow', (tester) async {
      await _pump(
        tester,
        CustomScrollView(
          slivers: [
            HomeFeedSections(
              state: HomeFeedState(feed: feed(), loading: false),
            ),
          ],
        ),
        locale: 'ar',
        textScale: 1.3,
      );
      expect(tester.takeException(), isNull);
    });
  });
}
