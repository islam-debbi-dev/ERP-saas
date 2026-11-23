import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/router/role_screens.dart';
import 'package:orvynt_starter/core/router/tab_routes.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfers_screen.dart';

import '../../helpers/pump_app.dart';
import 'transfer_fixtures.dart';

/// The tab at [tabPath] with its real sub-routes, its root page replaced
/// by a marker (the redirects are what is tested).
Future<GoRouter> pumpTab(
  WidgetTester tester,
  AuthUser user,
  String tabPath,
  String location,
) async {
  final tab = RoleScreens.allTabsFor(
    user.role,
  ).firstWhere((t) => t.path == tabPath);
  final router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: location,
    routes: [
      GoRoute(
        path: tabPath,
        builder: (_, _) => Scaffold(body: Text('root:$tabPath')),
        routes: tabSubRoutes(tab),
      ),
    ],
  );
  await tester.pumpWidget(
    BlocProvider<SessionCubit>(
      // A new session per pump: the same element would keep the first one.
      key: UniqueKey(),
      create: (_) => FakeSession(user),
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

void main() {
  tearDown(() => getIt.reset());

  final granted = [Permission.salesCreate, Permission.stockTransfer];

  testWidgets('a seller without the grant is sent back to Mon camion', (
    tester,
  ) async {
    fakeStockApi(baseRoutes());
    for (final path in [
      '/seller/truck/loads',
      '/seller/truck/loads/new?truck=v1',
      '/seller/truck/loads/t1',
    ]) {
      final router = await pumpTab(tester, seller(), '/seller/truck', path);
      expect(router.state.uri.path, '/seller/truck', reason: path);
      expect(find.text('root:/seller/truck'), findsOneWidget);
    }
  });

  testWidgets('with the grant he gets the list of his truck', (tester) async {
    fakeStockApi(baseRoutes());
    final router = await pumpTab(
      tester,
      seller(permissions: granted),
      '/seller/truck',
      '/seller/truck/loads?truck=v1',
    );
    expect(router.state.uri.path, '/seller/truck/loads');
    final screen = tester.widget<TransfersScreen>(find.byType(TransfersScreen));
    expect(screen.truckId, 'v1');
    expect(screen.canCreate, isTrue);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('the grant without WAREHOUSES is not enough', (tester) async {
    fakeStockApi(baseRoutes());
    final router = await pumpTab(
      tester,
      seller(permissions: granted, features: const [Feature.mobileApp]),
      '/seller/truck',
      '/seller/truck/loads/new',
    );
    expect(router.state.uri.path, '/seller/truck');
  });

  testWidgets('a livreur and a supervisor: the same rule', (tester) async {
    fakeStockApi(baseRoutes());
    var router = await pumpTab(
      tester,
      livreur(),
      '/livreur/truck',
      '/livreur/truck/loads/new',
    );
    expect(router.state.uri.path, '/livreur/truck');
    router = await pumpTab(
      tester,
      supervisor(),
      '/supervisor/more',
      '/supervisor/more/loads',
    );
    expect(router.state.uri.path, '/supervisor/more');
    router = await pumpTab(
      tester,
      supervisor(permissions: const [Permission.stockTransfer]),
      '/supervisor/more',
      '/supervisor/more/loads',
    );
    expect(router.state.uri.path, '/supervisor/more/loads');
  });

  for (final (user, shown) in [
    (supervisor(), false),
    (supervisor(permissions: const [Permission.stockTransfer]), true),
  ]) {
    testWidgets('supervisor Plus: Chargements ${shown ? 'shown' : 'hidden'}', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: Column(
              children: [
                for (final item in supervisorMenu(context)) Text(item.labelKey),
              ],
            ),
          ),
        ),
        locale: 'fr',
        user: user,
      );
      expect(
        find.text('transfer.title'),
        shown ? findsOneWidget : findsNothing,
      );
    });
  }

  for (final locale in ['ar', 'fr']) {
    testWidgets('[$locale] the seller\'s list at 360 dp', (tester) async {
      final adapter = fakeStockApi(baseRoutes());
      await pumpScreen(
        tester,
        const TransfersScreen(
          basePath: '/seller/truck/loads',
          truckId: 'v1',
          isTabRoot: false,
          canCreate: true,
        ),
        locale: locale,
        user: seller(permissions: granted),
      );
      expect(find.byType(ChoiceChip), findsNothing);
      expect(
        adapter.sent
            .where((r) => r.path == '/stock-transfers')
            .every((r) => r.query['warehouseId'] == 'v1'),
        isTrue,
      );
      expect(find.byType(FloatingActionButton), findsOneWidget);
      expectNoOverflow(tester);
      expectNoMoney(tester, figures: moneyFigures);
    });
  }
}
