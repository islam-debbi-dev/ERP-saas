import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/helpers/connectivity_services.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/localization/locale_cubit.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/router/role_screens.dart';
import 'package:orvynt_starter/core/router/tab_badges.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/core/theme/cubit/theme_cubit.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/logic/assistant_status_cubit.dart';
import 'package:orvynt_starter/features/main_screen/ui/main_screen.dart';
import 'package:orvynt_starter/features/main_screen/ui/widgets/custom_bottom_navigation.dart';
import 'package:orvynt_starter/features/main_screen/ui/widgets/no_connection_banner.dart';

import '../../helpers/pump_app.dart';

/// Offline state driven by the test; never touches the platform plugin.
class _FakeConnectivity extends ConnectivityService {
  @override
  Future<void> init({VoidCallback? onReconnect}) async {}
}

/// The screens under the tabs, at the same paths as `tab_routes.dart`
/// (the real screens need their repositories; the bar only reads the path).
/// The livreur's delivery is pushed on the root navigator, as in the app.
List<RouteBase> _subRoutes(String tab, GlobalKey<NavigatorState> root) =>
    switch (tab) {
      '/seller/clients' || '/seller/today' => [
        GoRoute(
          path: tab == '/seller/today' ? 'client/:clientId' : ':clientId',
          builder: (_, _) => const _Page('client-detail'),
          routes: [
            GoRoute(
              path: 'statement',
              builder: (_, _) => const _Page('client-statement'),
            ),
          ],
        ),
      ],
      '/seller/more' => [
        GoRoute(path: 'sales', builder: (_, _) => const _Page('my-sales')),
        GoRoute(path: 'assistant', builder: (_, _) => const _Page('assistant')),
      ],
      '/livreur/deliveries' => [
        // M6: the map sheet's "Ouvrir la fiche".
        GoRoute(
          path: 'client/:clientId',
          builder: (_, _) => const _Page('delivery-client'),
        ),
        GoRoute(
          path: ':orderId',
          parentNavigatorKey: root,
          builder: (_, _) => const _Page('delivery', action: true),
        ),
      ],
      '/livreur/more' => [
        GoRoute(
          path: 'deliveries',
          builder: (_, _) => const _Page('my-deliveries'),
        ),
      ],
      '/supervisor/team' => [
        GoRoute(
          path: ':sellerId',
          builder: (_, _) => const _Page('member-day', action: true),
        ),
      ],
      // M6: the team's client map.
      '/supervisor/controls' => [
        GoRoute(path: 'map', builder: (_, _) => const _Page('team-map')),
      ],
      '/supervisor/more' => [
        GoRoute(
          path: 'objectives',
          builder: (_, _) => const _Page('team-objectives'),
        ),
      ],
      // M3b: forms on the root navigator, like tab_routes.dart.
      '/storekeeper/loads' => [
        GoRoute(
          path: 'new',
          parentNavigatorKey: root,
          builder: (_, _) => const _Page('new-load', action: true),
        ),
        GoRoute(
          path: ':transferId',
          builder: (_, _) => const _Page('transfer-detail', action: true),
        ),
      ],
      '/storekeeper/trucks' => [
        GoRoute(
          path: ':truckId',
          builder: (_, _) => const _Page('truck-stock', action: true),
        ),
      ],
      '/storekeeper/inventory' => [
        GoRoute(
          path: ':inventoryId',
          parentNavigatorKey: root,
          builder: (_, _) => const _Page('count', action: true),
        ),
      ],
      '/storekeeper/more' => [
        GoRoute(path: 'assistant', builder: (_, _) => const _Page('assistant')),
      ],
      _ => const [],
    };

/// A screen; [action] gives it its own bottom action bar (like member day).
class _Page extends StatelessWidget {
  const _Page(this.name, {this.action = false});
  final String name;
  final bool action;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(name)),
    body: ListView(children: [Text('page:$name')]),
    bottomNavigationBar: action
        ? SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton(
                key: const Key('action'),
                onPressed: () {},
                child: const Text('OK'),
              ),
            ),
          )
        : null,
  );
}

/// The app's shells (one per role, one branch per tab) over stub pages.
GoRouter _router(String initial) {
  final root = GlobalKey<NavigatorState>();
  return GoRouter(
    navigatorKey: root,
    initialLocation: initial,
    routes: [
      for (final entry in RoleScreens.tabs.entries)
        StatefulShellRoute.indexedStack(
          builder: (_, _, shell) =>
              MainScreen(role: entry.key, navigationShell: shell),
          branches: [
            for (final tab in entry.value)
              StatefulShellBranch(
                routes: [
                  GoRoute(
                    path: tab.path,
                    builder: (_, _) => _Page('root:${tab.path}'),
                    routes: _subRoutes(tab.path, root),
                  ),
                ],
              ),
          ],
        ),
    ],
  );
}

Future<GoRouter> _pump(
  WidgetTester tester,
  AuthUser user,
  String initial, {
  String locale = 'ar',
  bool assistant = true,
}) async {
  rootBundle.clear();
  tester.view.physicalSize = phone360;
  tester.view.devicePixelRatio = 1;
  tester.view.padding = const FakeViewPadding(bottom: 24);
  addTearDown(tester.view.reset);
  final router = _router(initial);
  addTearDown(router.dispose);
  await tester.pumpWidget(
    MultiBlocProvider(
      providers: [
        BlocProvider<SessionCubit>(create: (_) => FakeSession(user)),
        BlocProvider(create: (_) => ThemeCubit(ThemeMode.light)),
        BlocProvider(create: (_) => LocaleCubit(Locale(locale))),
        BlocProvider(
          create: (_) => AssistantStatusCubit.seeded(
            AssistantStatus(available: assistant, provider: 'GEMINI'),
          ),
        ),
      ],
      child: ScreenUtilInit(
        designSize: const Size(375, 812),
        minTextAdapt: true,
        builder: (_, _) => MaterialApp.router(
          debugShowCheckedModeBanner: false,
          theme: appThemeLight,
          locale: Locale(locale),
          supportedLocales: const [Locale('ar'), Locale('fr'), Locale('en')],
          localizationsDelegates: const [
            AppLocalizationsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          routerConfig: router,
        ),
      ),
    ),
  );
  // Strings load on real async I/O, outside the fake clock.
  for (var i = 0; i < 20; i++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pump();
    if (find.byType(CustomBottomNavigation).evaluate().isNotEmpty) break;
  }
  await tester.pumpAndSettle();
  return router;
}

/// The bar is on screen and takes taps (not slid out / ignored).
bool _barShown(WidgetTester tester) {
  final bar = find.byType(CustomBottomNavigation);
  if (bar.evaluate().isEmpty) return false;
  final slide = tester.widget<AnimatedSlide>(
    find.ancestor(of: bar, matching: find.byType(AnimatedSlide)),
  );
  final ignore = tester.widget<IgnorePointer>(
    find.ancestor(of: bar, matching: find.byType(IgnorePointer)).first,
  );
  return slide.offset == Offset.zero &&
      !ignore.ignoring &&
      tester.getRect(bar).top < phone360.height;
}

Future<void> _push(WidgetTester tester, GoRouter router, String path) async {
  router.push(path);
  await tester.pumpAndSettle();
}

Future<void> _back(WidgetTester tester) async {
  // The Android back button / iOS back gesture go through the router.
  await tester.binding.handlePopRoute();
  await tester.pumpAndSettle();
}

void main() {
  late _FakeConnectivity connectivity;
  setUp(() {
    connectivity = _FakeConnectivity();
    getIt.registerSingleton<ConnectivityService>(connectivity);
    TabBadges.reset();
  });
  tearDown(() => getIt.reset());

  test('isTabRoot: only the role tab roots', () {
    expect(RoleScreens.isTabRoot('SELLER', '/seller/today'), isTrue);
    expect(RoleScreens.isTabRoot('SELLER', '/seller/more'), isTrue);
    expect(RoleScreens.isTabRoot('SELLER', '/seller/more/sales'), isFalse);
    expect(RoleScreens.isTabRoot('SELLER', '/seller/clients/c1'), isFalse);
    expect(RoleScreens.isTabRoot('SELLER', '/livreur/deliveries'), isFalse);
    expect(RoleScreens.isTabRoot('LIVREUR', '/livreur/deliveries'), isTrue);
    expect(RoleScreens.isTabRoot('STOREKEEPER', '/storekeeper/loads'), isTrue);
    expect(
      RoleScreens.isTabRoot('STOREKEEPER', '/storekeeper/loads/new'),
      isFalse,
    );
  });

  for (final locale in ['ar', 'fr']) {
    group('[$locale]', () {
      final roles = <String, AuthUser>{
        'seller': seller(),
        'livreur': livreur(),
        'supervisor': supervisor(),
        'storekeeper': storekeeper(),
      };
      for (final MapEntry(key: name, value: user) in roles.entries) {
        testWidgets('$name: bar on every tab root', (tester) async {
          final tabs = RoleScreens.visibleTabsFor(user);
          final router = await _pump(
            tester,
            user,
            tabs.first.path,
            locale: locale,
          );
          for (final tab in tabs) {
            router.go(tab.path);
            await tester.pumpAndSettle();
            expect(find.text('page:root:${tab.path}'), findsOneWidget);
            expect(_barShown(tester), isTrue, reason: tab.path);
          }
          expectNoOverflow(tester);
        });
      }

      const subPages = <(String, String, String, String)>[
        // role, tab root, sub-page, page name
        ('seller', '/seller/clients', '/seller/clients/c1', 'client-detail'),
        (
          'seller',
          '/seller/clients',
          '/seller/clients/c1/statement',
          'client-statement',
        ),
        ('seller', '/seller/today', '/seller/today/client/c1', 'client-detail'),
        ('seller', '/seller/more', '/seller/more/sales', 'my-sales'),
        (
          'livreur',
          '/livreur/deliveries',
          '/livreur/deliveries/o1',
          'delivery',
        ),
        (
          'livreur',
          '/livreur/more',
          '/livreur/more/deliveries',
          'my-deliveries',
        ),
        (
          'supervisor',
          '/supervisor/team',
          '/supervisor/team/s1?date=2026-11-23',
          'member-day',
        ),
        (
          'supervisor',
          '/supervisor/more',
          '/supervisor/more/objectives',
          'team-objectives',
        ),
        (
          'supervisor',
          '/supervisor/controls',
          '/supervisor/controls/map',
          'team-map',
        ),
        (
          'livreur',
          '/livreur/deliveries',
          '/livreur/deliveries/client/c1',
          'delivery-client',
        ),
        (
          'storekeeper',
          '/storekeeper/loads',
          '/storekeeper/loads/new',
          'new-load',
        ),
        (
          'storekeeper',
          '/storekeeper/loads',
          '/storekeeper/loads/t1',
          'transfer-detail',
        ),
        (
          'storekeeper',
          '/storekeeper/trucks',
          '/storekeeper/trucks/v1',
          'truck-stock',
        ),
        (
          'storekeeper',
          '/storekeeper/inventory',
          '/storekeeper/inventory/i1',
          'count',
        ),
        (
          'storekeeper',
          '/storekeeper/more',
          '/storekeeper/more/assistant',
          'assistant',
        ),
      ];
      for (final (role, root, sub, page) in subPages) {
        testWidgets('$role: bar hidden on $sub, back brings it', (
          tester,
        ) async {
          final user = {
            'seller': seller(),
            'livreur': livreur(),
            'supervisor': supervisor(),
            'storekeeper': storekeeper(),
          }[role]!;
          final router = await _pump(tester, user, root, locale: locale);
          expect(_barShown(tester), isTrue);

          await _push(tester, router, sub);
          expect(router.state.uri.path, Uri.parse(sub).path);
          expect(find.text('page:$page'), findsOneWidget);
          expect(_barShown(tester), isFalse);

          // A screen's own action bar sits at the bottom, above the inset.
          final action = find.byKey(const Key('action'));
          if (action.evaluate().isNotEmpty) {
            final bottom = tester.getRect(action).bottom;
            expect(bottom, lessThanOrEqualTo(phone360.height - 24));
            expect(bottom, greaterThan(phone360.height - 24 - 24));
          }
          expectNoOverflow(tester);

          await _back(tester);
          expect(router.state.uri.path, root);
          expect(find.text('page:root:$root'), findsOneWidget);
          expect(_barShown(tester), isTrue);
          expectNoOverflow(tester);
        });
      }
    });
  }

  testWidgets('tabs keep their stack; re-tapping a tab still works', (
    tester,
  ) async {
    final router = await _pump(tester, seller(), '/seller/clients');
    // Bar positions of the seller's tabs: 0 today, 1 clients.
    Finder tab(int i) => find.byKey(Key('nav-tab-$i'));
    String at() => router.state.uri.path;

    // Re-tapping the current tab on its root keeps the root and the bar.
    await tester.tap(tab(1));
    await tester.pumpAndSettle();
    expect(at(), '/seller/clients');
    expect(_barShown(tester), isTrue);

    // Into a client, away to Today, back to Clients: the client is still
    // open (StatefulShellRoute stack) and the bar is hidden again.
    await _push(tester, router, '/seller/clients/c1');
    expect(_barShown(tester), isFalse);
    // (no bar here: leave by a link, as Today's « clients » shortcut does)
    router.go('/seller/today');
    await tester.pumpAndSettle();
    expect(at(), '/seller/today');
    expect(_barShown(tester), isTrue);
    await tester.tap(tab(1));
    await tester.pumpAndSettle();
    expect(at(), '/seller/clients/c1');
    expect(_barShown(tester), isFalse);

    await _back(tester);
    expect(at(), '/seller/clients');
    expect(_barShown(tester), isTrue);
    expectNoOverflow(tester);
  });

  testWidgets('offline banner and tab badges still show', (tester) async {
    TabBadges.of('/livreur/deliveries').value = 3;
    await _pump(tester, livreur(), '/livreur/deliveries', locale: 'fr');
    expect(find.text('3'), findsWidgets);
    connectivity.isOffline.value = true;
    await tester.pumpAndSettle();
    expect(find.byType(NoConnectionBanner), findsOneWidget);
    expectNoOverflow(tester);
  });

  testWidgets('an assistant link to a client goes to the Clients tab; the '
      'Plus tab still holds the chat (M4)', (tester) async {
    final router = await _pump(tester, seller(), '/seller/more');
    await _push(tester, router, '/seller/more/assistant');
    expect(find.text('page:assistant'), findsOneWidget);

    // AnswerLinks goes to a route of another tab (a push across shell
    // branches loses the location on pop).
    router.go('/seller/clients/c1');
    await tester.pumpAndSettle();
    expect(find.text('page:client-detail'), findsOneWidget);
    expect(_barShown(tester), isFalse);

    await _back(tester);
    expect(find.text('page:root:/seller/clients'), findsOneWidget);
    expect(_barShown(tester), isTrue);

    // Plus brings the chat back where it was.
    await tester.tap(find.byIcon(Icons.more_horiz).last);
    await tester.pumpAndSettle();
    expect(find.text('page:assistant'), findsOneWidget);
    expect(_barShown(tester), isFalse);

    // Back closes the chat, onto Plus.
    await _back(tester);
    expect(find.text('page:root:/seller/more'), findsOneWidget);
    expect(_barShown(tester), isTrue);
  });

  group('assistant button', () {
    final fab = find.byWidgetPredicate(
      (w) => w is FloatingActionButton && w.heroTag == 'assistant-fab',
    );

    /// On screen and takes taps (not slid out / ignored / dropped).
    bool fabShown(WidgetTester tester) {
      if (fab.evaluate().isEmpty) return false;
      final ignore = tester.widget<IgnorePointer>(
        find.ancestor(of: fab, matching: find.byType(IgnorePointer)).first,
      );
      final opacity = tester.widget<AnimatedOpacity>(
        find.ancestor(of: fab, matching: find.byType(AnimatedOpacity)).first,
      );
      return !ignore.ignoring && opacity.opacity == 1;
    }

    for (final locale in ['ar', 'fr']) {
      testWidgets('on a tab root, above the bar, at the start side in '
          '$locale', (tester) async {
        await _pump(tester, seller(), '/seller/today', locale: locale);
        expect(fabShown(tester), isTrue);
        expect(
          find.descendant(of: fab, matching: find.byIcon(Icons.auto_awesome_outlined)),
          findsOneWidget,
        );
        final rect = tester.getRect(fab);
        // A word with the icon, a touch target of 48 dp at least.
        expect(rect.height, greaterThanOrEqualTo(48));
        expect(
          find.descendant(
            of: fab,
            matching: find.text(locale == 'ar' ? 'اسأل المساعد' : 'Assistant'),
          ),
          findsOneWidget,
        );
        // Never over the bar.
        expect(
          rect.bottom,
          lessThanOrEqualTo(tester.getRect(find.byType(CustomBottomNavigation)).top),
        );
        // Start side: left in LTR (fr), right in RTL (ar).
        final middle = phone360.width / 2;
        expect(
          locale == 'ar' ? rect.center.dx > middle : rect.center.dx < middle,
          isTrue,
        );
        expectNoOverflow(tester);
      });
    }

    testWidgets('the word fits inside the button (a pill, not a disc)', (
      tester,
    ) async {
      await _pump(tester, seller(), '/seller/today', locale: 'fr');
      final box = tester.getRect(fab);
      final word = tester.getRect(
        find.descendant(of: fab, matching: find.text('Assistant')),
      );
      expect(box.width, greaterThan(box.height * 2));
      expect(word.left, greaterThanOrEqualTo(box.left));
      expect(word.right, lessThanOrEqualTo(box.right));
    });

    testWidgets('hides on a sub-page and comes back', (tester) async {
      final router = await _pump(tester, seller(), '/seller/more');
      expect(fabShown(tester), isTrue);
      await _push(tester, router, '/seller/more/sales');
      expect(fabShown(tester), isFalse);
      await _back(tester);
      expect(fabShown(tester), isTrue);
    });

    testWidgets('hides while the keyboard is open', (tester) async {
      await _pump(tester, seller(), '/seller/today');
      expect(fabShown(tester), isTrue);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expect(fabShown(tester), isFalse);
      tester.view.viewInsets = FakeViewPadding.zero;
      await tester.pumpAndSettle();
      expect(fabShown(tester), isTrue);
    });

    testWidgets('is not there when the assistant is not available', (
      tester,
    ) async {
      await _pump(tester, seller(), '/seller/today', assistant: false);
      expect(fabShown(tester), isFalse);
    });

    testWidgets('a tap opens the assistant and back returns to the same tab', (
      tester,
    ) async {
      await _pump(tester, seller(), '/seller/clients');
      await tester.tap(fab);
      await tester.pumpAndSettle();
      expect(find.text('page:assistant'), findsOneWidget);
      expect(_barShown(tester), isFalse);
      expect(fabShown(tester), isFalse);
      await _back(tester);
      expect(find.text('page:root:/seller/clients'), findsOneWidget);
      expect(_barShown(tester), isTrue);
      expect(fabShown(tester), isTrue);
    });

    testWidgets('every role gets it on its tab roots', (tester) async {
      for (final (user, path) in [
        (livreur(), '/livreur/deliveries'),
        (supervisor(), '/supervisor/team'),
        (storekeeper(), '/storekeeper/loads'),
      ]) {
        await _pump(tester, user, path);
        expect(fabShown(tester), isTrue, reason: path);
      }
    });
  });

  testWidgets('CustomBottomNavigation.height is the real height of the bar', (
    tester,
  ) async {
    await _pump(tester, seller(), '/seller/today');
    final rect = tester.getRect(find.byType(CustomBottomNavigation));
    // The view's bottom padding (24) is the safe area under the bar.
    expect(rect.height - 24, CustomBottomNavigation.height);
    expect(rect.bottom, phone360.height);
  });

  for (final locale in ['ar', 'fr']) {
    testWidgets('every tab shows its word and is at least 48 dp, no overflow '
        'in $locale', (tester) async {
      for (final (user, role) in [
        (seller(), 'SELLER'),
        (livreur(), 'LIVREUR'),
        (supervisor(), 'SUPERVISOR'),
        (storekeeper(), 'STOREKEEPER'),
      ]) {
        final tabs = RoleScreens.visibleTabsFor(user);
        await _pump(tester, user, tabs.first.path, locale: locale);
        for (var i = 0; i < tabs.length; i++) {
          final tab = find.byKey(Key('nav-tab-$i'));
          final r = tester.getRect(tab);
          expect(r.height, greaterThanOrEqualTo(48), reason: '$role tab $i');
          expect(r.width, greaterThanOrEqualTo(48), reason: '$role tab $i');
          // The word is on the tab, inactive ones included.
          final word = find.descendant(of: tab, matching: find.byType(Text));
          expect(word, findsOneWidget, reason: '$role tab $i has a word');
          expect(
            tester.widget<Text>(word).data,
            isNot(anyOf(isNull, isEmpty, contains('.'))),
            reason: '$role tab $i word is a real label, not a key',
          );
        }
        expectNoOverflow(tester);
      }
    });
  }
}
