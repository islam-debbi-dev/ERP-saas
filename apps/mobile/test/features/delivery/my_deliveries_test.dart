import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/router/tab_routes.dart';
import 'package:orvynt_starter/features/account/ui/account_screen.dart';
import 'package:orvynt_starter/features/delivery/ui/my_deliveries_screen.dart';
import 'package:orvynt_starter/features/orders/data/repo/orders_repository.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'deliveries_test.dart' show summaryJson;

void main() {
  group('my deliveries at 360 dp', () {
    late List<SentRequest> sent;
    setUp(() {
      final adapter = FakeAdapter((o) {
        final delivered = {
          ...summaryJson('o1', 'c1', 'Supérette El Baraka'),
          'status': 'DELIVERED',
          'sale': {'id': 's1', 'number': 'BL-2026-000131'},
        };
        return FakeReply(200, {
          'items': [delivered],
          'nextCursor': null,
        });
      });
      sent = adapter.sent;
      getIt.registerSingleton<OrdersRepository>(
        OrdersRepository(
          ApiClient(
            dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
              ..httpClientAdapter = adapter,
          ),
        ),
      );
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('delivered orders with their BL in $locale', (tester) async {
        await pumpScreen(
          tester,
          const MyDeliveriesScreen(),
          locale: locale,
          user: livreur(),
        );
        expect(find.text('BL-2026-000131'), findsOneWidget);
        expect(sent.first.path, '/orders');
        expect(sent.first.body, isNull);
        expectNoOverflow(tester);
      });
    }
  });

  group('the livreur\'s Plus menu', () {
    testWidgets('his deliveries; versements only with the grant', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        Builder(
          builder: (context) => AccountScreen(menu: livreurMenu(context)),
        ),
        locale: 'fr',
        user: livreur(),
      );
      expect(find.text('Mes livraisons'), findsOneWidget);
      expect(find.text('Mes versements'), findsNothing);
      expectNoOverflow(tester);
    });

    testWidgets('a PAYMENTS_CREATE grant adds Mes versements', (tester) async {
      await pumpScreen(
        tester,
        Builder(
          builder: (context) => AccountScreen(menu: livreurMenu(context)),
        ),
        locale: 'fr',
        user: livreur(permissions: const [Permission.paymentsCreate]),
      );
      expect(find.text('Mes versements'), findsOneWidget);
    });
  });
}
