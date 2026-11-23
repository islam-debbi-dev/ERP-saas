import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/trucks_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'transfer_fixtures.dart';

void main() {
  tearDown(() => getIt.reset());

  Map<String, FakeRoute> routes() => {
    ...baseRoutes(),
    'GET /stock': (_) => FakeReply(
      200,
      stockPageJson([
        levelJson(qtyBase: '29.000'),
        levelJson(
          productId: 'p2',
          designation: "Jus d'orange 1 L",
          qtyBase: '0.000',
          pack: false,
        ),
      ]),
    ),
  };

  for (final locale in ['ar', 'fr']) {
    group('[$locale] at 360 dp', () {
      testWidgets('each truck with its driver of today', (tester) async {
        fakeStockApi(routes());
        await pumpScreen(
          tester,
          const TrucksScreen(basePath: '/storekeeper/trucks'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byType(TruckTile), findsNWidgets(2));
        expect(find.text('CAM-01 · Hyundai HD35'), findsOneWidget);
        expect(find.textContaining('Karim Vendeur'), findsOneWidget);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });

      testWidgets('a truck\'s stock in cartons + pièces, no cost', (
        tester,
      ) async {
        fakeStockApi(routes());
        await pumpScreen(
          tester,
          const TruckStockScreen(
            truckId: 'v1',
            basePath: '/storekeeper/trucks/v1',
          ),
          locale: locale,
          user: storekeeper(),
        );
        // 29 pièces = 4 cartons of 6 + 5; the empty product is not listed.
        expect(find.textContaining('4 CRT + 5 PCE'), findsOneWidget);
        expect(find.textContaining("Jus d'orange"), findsNothing);
        expect(find.byKey(const Key('truck-load')), findsOneWidget);
        expect(find.byKey(const Key('truck-unload')), findsOneWidget);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });

      testWidgets('without STOCK_TRANSFER: read only', (tester) async {
        fakeStockApi(routes());
        await pumpScreen(
          tester,
          const TruckStockScreen(
            truckId: 'v1',
            basePath: '/storekeeper/trucks/v1',
          ),
          locale: locale,
          user: storekeeper(permissions: const [Permission.stockCount]),
        );
        expect(find.byKey(const Key('truck-load')), findsNothing);
        expect(find.byKey(const Key('truck-unload')), findsNothing);
        expectNoOverflow(tester);
      });
    });
  }
}
