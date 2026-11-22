import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/router/tab_badges.dart';
import 'package:orvynt_starter/features/delivery/data/deliveries_repository.dart';
import 'package:orvynt_starter/features/delivery/logic/delivery_groups.dart';
import 'package:orvynt_starter/features/delivery/ui/deliveries_screen.dart';
import 'package:orvynt_starter/features/orders/data/models/order.dart';
import 'package:orvynt_starter/features/orders/data/repo/orders_repository.dart';
import 'package:orvynt_starter/features/today/data/models/today.dart';
import 'package:orvynt_starter/features/today/data/repo/today_repository.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> summaryJson(
  String id,
  String clientId,
  String clientName, {
  String? requestedDate = '2026-11-22',
  String createdAt = '2026-11-21T09:00:00.000Z',
  int shortLines = 0,
}) => {
  'id': id,
  'number': 'BC-2026-0000${id.substring(1)}',
  'status': 'CONFIRMED',
  'client': {'id': clientId, 'code': 'CL-$clientId', 'name': clientName},
  'seller': {'id': 'seller-1', 'fullName': 'Karim Vendeur'},
  'livreur': {'id': 'livreur-1', 'fullName': 'Samir Livreur'},
  'deliveryVehicle': {
    'id': 'v2',
    'code': 'CAM-02',
    'name': 'Isuzu NPR',
    'wilayaCode': 16,
  },
  'requestedDate': requestedDate,
  'totalTtc': '28560.00',
  'lineCount': 3,
  'shortLines': shortLines,
  'sale': null,
  'createdAt': createdAt,
};

Map<String, dynamic> stopJson(int position, String clientId, String name) => {
  'routeId': 'r1',
  'position': position,
  'client': {
    'id': clientId,
    'code': 'CL-$clientId',
    'name': name,
    'phone': null,
    'address': null,
    'commune': 'Bab Ezzouar',
    'lat': null,
    'lng': null,
  },
  'balance': '0.00',
  'lastVisit': null,
  'lastSale': null,
  'visitedToday': false,
  'today': {'saleId': null, 'orderId': null, 'paymentId': null},
};

Map<String, dynamic> todayJson(List<Map<String, dynamic>> stops) => {
  'day': '2026-11-22',
  'weekday': 0,
  'vehicle': null,
  'routes': <Object>[],
  'stops': stops,
  'planned': stops.length,
  'visited': 0,
};

OrderSummary summary(
  String id,
  String clientId,
  String name, {
  String? requestedDate = '2026-11-22',
  String createdAt = '2026-11-21T09:00:00.000Z',
}) => OrderSummary.fromJson(
  summaryJson(
    id,
    clientId,
    name,
    requestedDate: requestedDate,
    createdAt: createdAt,
  ),
);

ApiClient apiWith(FakeAdapter a) => ApiClient(
  dio: Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = a,
);

void main() {
  group('groupDeliveries', () {
    test('today\'s stops first in route order, then clients by name', () {
      final board = groupDeliveries(
        [
          summary('o1', 'zz', 'Zitouna'),
          summary('o2', 'c3', 'Épicerie du Centre'),
          summary('o3', 'aa', 'alimentation Amine'),
          summary('o4', 'c1', 'Supérette El Baraka'),
        ],
        [
          TodayStop.fromJson(stopJson(1, 'c1', 'Supérette El Baraka')),
          TodayStop.fromJson(stopJson(2, 'c2', 'Benali')),
          TodayStop.fromJson(stopJson(3, 'c3', 'Épicerie du Centre')),
        ],
      );
      expect(board.groups.map((g) => g.clientId), ['c1', 'c3', 'aa', 'zz']);
      expect(board.groups.map((g) => g.stop), [1, 3, null, null]);
      expect(board.count, 4);
    });

    test('one group per client, oldest requested date first', () {
      final board = groupDeliveries([
        summary('o1', 'c1', 'A', requestedDate: null),
        summary('o2', 'c1', 'A', requestedDate: '2026-11-23'),
        summary(
          'o3',
          'c1',
          'A',
          requestedDate: '2026-11-22',
          createdAt: '2026-11-22T08:00:00.000Z',
        ),
        summary('o4', 'c1', 'A', requestedDate: '2026-11-22'),
      ], const []);
      expect(board.groups, hasLength(1));
      expect(board.groups.single.orders.map((o) => o.id), [
        'o4',
        'o3',
        'o2',
        'o1',
      ]);
      expect(board.groups.single.onRoute, isFalse);
    });

    test('a client on two stops keeps his first place', () {
      final board = groupDeliveries(
        [summary('o1', 'c1', 'A')],
        [
          TodayStop.fromJson(stopJson(4, 'c1', 'A')),
          TodayStop.fromJson(stopJson(9, 'c1', 'A')),
        ],
      );
      expect(board.groups.single.stop, 1);
    });

    test('an empty list is an empty board', () {
      final board = groupDeliveries(const [], const []);
      expect(board.isEmpty, isTrue);
      expect(board.count, 0);
    });
  });

  group('DeliveriesRepository', () {
    test('reads every page of confirmed orders, then today\'s stops', () async {
      final api = FakeAdapter((o) {
        if (o.path == '/me/today') {
          return FakeReply(200, todayJson([stopJson(1, 'c2', 'B')]));
        }
        final cursor = o.queryParameters['cursor'];
        return FakeReply(200, {
          'items': cursor == null
              ? [summaryJson('o1', 'c1', 'A')]
              : [summaryJson('o2', 'c2', 'B')],
          'nextCursor': cursor == null ? 'o1' : null,
        });
      });
      final client = apiWith(api);
      final repo = DeliveriesRepository(
        OrdersRepository(client),
        TodayRepository(client),
      );
      final result = await repo.board(withRoute: true);
      final board = (result as dynamic).data as DeliveriesBoard;
      expect(board.groups.map((g) => g.clientId), ['c2', 'c1']);
      final listCalls = api.sent.where((r) => r.path == '/orders').toList();
      expect(listCalls, hasLength(2));
      expect(api.sent.where((r) => r.path == '/me/today'), hasLength(1));
    });

    test(
      'without TOURNEES, or when /me/today fails, groups by client',
      () async {
        for (final withRoute in [false, true]) {
          final api = FakeAdapter((o) {
            if (o.path == '/me/today') {
              return const FakeReply(403, {
                'code': 'FEATURE_NOT_IN_PLAN',
                'message': 'no',
              });
            }
            return FakeReply(200, {
              'items': [summaryJson('o1', 'c1', 'A')],
              'nextCursor': null,
            });
          });
          final client = apiWith(api);
          final result = await DeliveriesRepository(
            OrdersRepository(client),
            TodayRepository(client),
          ).board(withRoute: withRoute);
          final board = (result as dynamic).data as DeliveriesBoard;
          expect(board.groups.single.onRoute, isFalse);
          expect(
            api.sent.where((r) => r.path == '/me/today'),
            hasLength(withRoute ? 1 : 0),
          );
        }
      },
    );
  });

  group('screen at 360 dp', () {
    late List<Map<String, dynamic>> orders;
    setUp(() {
      orders = [
        summaryJson('o1', 'c1', 'Supérette El Baraka', shortLines: 2),
        summaryJson('o2', 'c1', 'Supérette El Baraka', requestedDate: null),
        summaryJson(
          'o3',
          'c9',
          'Alimentation Générale Benali et Fils Grossiste Détail',
        ),
      ];
      final client = apiWith(
        FakeAdapter((o) {
          if (o.path == '/me/today') {
            return FakeReply(
              200,
              todayJson([stopJson(1, 'c1', 'Supérette El Baraka')]),
            );
          }
          return FakeReply(200, {'items': orders, 'nextCursor': null});
        }),
      );
      getIt.registerSingleton<DeliveriesRepository>(
        DeliveriesRepository(OrdersRepository(client), TodayRepository(client)),
      );
    });
    tearDown(() {
      getIt.reset();
      TabBadges.reset();
    });

    for (final locale in ['ar', 'fr']) {
      testWidgets('grouped deliveries in $locale', (tester) async {
        await pumpScreen(
          tester,
          const DeliveriesScreen(tabPath: '/livreur/deliveries'),
          locale: locale,
          user: livreur(),
        );
        expect(find.text('Supérette El Baraka'), findsOneWidget);
        expect(find.text('BC-2026-00001'), findsOneWidget);
        expect(find.byType(DeliveryTile), findsNWidgets(3));
        expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
        expect(TabBadges.of('/livreur/deliveries').value, 3);
        expectNoOverflow(tester);
      });

      testWidgets('empty list in $locale', (tester) async {
        orders = [];
        await pumpScreen(
          tester,
          const DeliveriesScreen(tabPath: '/livreur/deliveries'),
          locale: locale,
          user: livreur(features: const [Feature.mobileApp]),
        );
        expect(find.byIcon(Icons.inventory_2_outlined), findsOneWidget);
        expect(TabBadges.of('/livreur/deliveries').value, 0);
        expectNoOverflow(tester);
      });
    }
  });
}
