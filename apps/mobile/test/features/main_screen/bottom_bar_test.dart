import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_nav_bar/google_nav_bar.dart';
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
      ],
      '/livreur/deliveries' => [
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
      '/supervisor/more' => [
        GoRoute(
          path: 'objectives',
          builder: (_, _) => const _Page('team-objectives'),
        ),
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
  });

  for (final locale in ['ar', 'fr']) {
    group('[$locale]', () {
      final roles = <String, AuthUser>{
        'seller': seller(),
        'livreur': livreur(),
        'supervisor': supervisor(),
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
      ];
      for (final (role, root, sub, page) in subPages) {
        testWidgets('$role: bar hidden on $sub, back brings it', (
          tester,
        ) async {
          final user = {
            'seller': seller(),
            'livreur': livreur(),
            'supervisor': supervisor(),
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
    Finder tab(int i) => find.byType(GButton).at(i);
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
}
