import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/map/client_map_repository.dart';
import 'package:orvynt_starter/core/map/client_map_sheet.dart';
import 'package:orvynt_starter/core/map/client_marker.dart';
import 'package:orvynt_starter/core/map/map_list_toggle.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/router/tab_badges.dart';
import 'package:orvynt_starter/features/clients/data/models/client.dart';
import 'package:orvynt_starter/features/clients/data/repo/clients_repository.dart';
import 'package:orvynt_starter/features/delivery/data/deliveries_repository.dart';
import 'package:orvynt_starter/features/delivery/logic/delivery_groups.dart';
import 'package:orvynt_starter/features/delivery/logic/delivery_points.dart';
import 'package:orvynt_starter/features/delivery/ui/deliveries_screen.dart';
import 'package:orvynt_starter/features/orders/data/models/order.dart';
import 'package:orvynt_starter/features/orders/data/repo/orders_repository.dart';
import 'package:orvynt_starter/features/today/data/models/today.dart';
import 'package:orvynt_starter/features/today/data/repo/today_repository.dart';

import '../../core/map/map_core_test.dart' show mapPoint;
import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_app.dart';
import 'deliveries_test.dart' show stopJson, summary, summaryJson, todayJson;

Map<String, dynamic> _locatedStop(
  int n,
  String id,
  String name, {
  required double lat,
  required double lng,
}) {
  final s = stopJson(n, id, name);
  return {
    ...s,
    'client': <String, dynamic>{
      ...(s['client'] as Map<String, dynamic>),
      'lat': lat,
      'lng': lng,
    },
  };
}

void main() {
  group('deliveryPins', () {
    final groups = groupDeliveries(
      [
        summary('o1', 'c1', 'A'),
        summary('o2', 'c1', 'A'),
        summary('o3', 'c2', 'B'),
        summary('o4', 'c3', 'C'),
      ],
      [TodayStop.fromJson(stopJson(1, 'c2', 'B'))],
    ).groups;

    test('the map answer first, then the stop, then a read client', () {
      final pins = deliveryPins(
        groups,
        stops: [
          TodayStop.fromJson(_locatedStop(1, 'c2', 'B', lat: 36.8, lng: 3.2)),
        ],
        mapPoints: {
          'c1': ClientMapPoint.fromJson(
            mapPoint('c1', 'A', balance: '500.00', overLimit: true),
          ),
        },
        fetched: {
          'c3': Client.fromJson(
            clientJson(
              id: 'c3',
              balance: '10.00',
              location: {'lat': 36.9, 'lng': 3.3},
            ),
          ),
        },
      );
      final byId = {for (final p in pins) p.group.clientId: p};
      expect(byId['c1']!.point, const LatLng(36.7, 3.1));
      expect(byId['c1']!.overLimit, isTrue);
      expect(byId['c1']!.group.orders, hasLength(2));
      expect(byId['c2']!.point, const LatLng(36.8, 3.2));
      expect(byId['c3']!.point, const LatLng(36.9, 3.3));
      expect(byId['c3']!.balance, Decimal.parse('10'));
    });

    test('a client nobody placed has no point', () {
      final pins = deliveryPins(groups);
      expect(pins.every((p) => p.point == null), isTrue);
    });

    test('reads clients one by one only when the map answer is cut', () {
      final stops = [
        TodayStop.fromJson(_locatedStop(1, 'c2', 'B', lat: 36.8, lng: 3.2)),
      ];
      final complete = ClientMapData(
        points: [ClientMapPoint.fromJson(mapPoint('c1', 'A'))],
      );
      expect(clientsToFetch(groups, stops: stops, map: complete), isEmpty);
      final cut = ClientMapData(points: complete.points, truncated: true);
      expect(clientsToFetch(groups, stops: stops, map: cut), ['c3']);
      expect(clientsToFetch(groups, stops: stops, map: null), ['c1', 'c3']);
    });
  });

  group('Livraisons map at 360 dp', () {
    late FakeAdapter adapter;
    late Map<String, dynamic> mapJson;

    setUp(() {
      TabBadges.reset();
      mapJson = {
        'points': [
          mapPoint(
            'c1',
            'Supérette El Baraka',
            balance: '900.00',
            lat: 36.70,
            lng: 3.00,
          ),
          mapPoint('c2', 'Épicerie du Centre', lat: 36.75, lng: 3.05),
        ],
        'truncated': false,
        'withoutLocation': 0,
      };
      adapter = FakeAdapter((o) {
        switch (o.path) {
          case '/me/today':
            return FakeReply(
              200,
              todayJson([stopJson(1, 'c2', 'Épicerie du Centre')]),
            );
          case '/clients/map':
            return FakeReply(200, mapJson);
          case '/clients/c3':
            return FakeReply(
              200,
              clientJson(
                id: 'c3',
                name: 'Kiosque Loin',
                location: {'lat': 36.80, 'lng': 3.10},
              ),
            );
          default:
            return FakeReply(200, {
              'items': [
                summaryJson('o1', 'c1', 'Supérette El Baraka'),
                summaryJson('o2', 'c1', 'Supérette El Baraka'),
                summaryJson('o3', 'c2', 'Épicerie du Centre'),
                summaryJson('o4', 'c3', 'Kiosque Loin'),
                summaryJson('o5', 'c4', 'Sans Point'),
              ],
              'nextCursor': null,
            });
        }
      });
      final api = ApiClient(
        dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
          ..httpClientAdapter = adapter,
      );
      getIt
        ..registerSingleton<DeliveriesRepository>(
          DeliveriesRepository(OrdersRepository(api), TodayRepository(api)),
        )
        ..registerSingleton<ClientMapRepository>(ClientMapRepository(api))
        ..registerSingleton<ClientsRepository>(ClientsRepository(api));
    });
    tearDown(() => getIt.reset());

    Future<void> openMap(WidgetTester tester) async {
      await tester.tap(find.byIcon(Icons.map_outlined));
      await tester.pumpAndSettle();
    }

    for (final locale in ['ar', 'fr']) {
      testWidgets('one marker per client with its orders in $locale', (
        tester,
      ) async {
        await pumpScreen(
          tester,
          const DeliveriesScreen(tabPath: '/livreur/deliveries'),
          locale: locale,
          user: livreur(),
        );
        await openMap(tester);
        final c1 = tester.widget<ClientMarker>(
          find.byKey(const ValueKey('delivery-c1')),
        );
        expect(c1.badge, 2);
        expect(c1.state, MarkerState.debt);
        expect(c1.icon, Icons.storefront); // not on today's route
        final c2 = tester.widget<ClientMarker>(
          find.byKey(const ValueKey('delivery-c2')),
        );
        expect(c2.number, 1); // stop 1, like the list
        expect(c2.badge, 1);
        // c3 is missing from a complete answer: no point, not read.
        expect(find.byKey(const ValueKey('delivery-c3')), findsNothing);
        expect(adapter.sent.where((r) => r.path == '/clients/c3'), isEmpty);
        expect(
          adapter.sent.singleWhere((r) => r.path == '/clients/map').query,
          {'includeInactive': 'true'},
        );
        expect(
          find.textContaining(
            locale == 'fr' ? 'Clients sans position' : 'زبائن بدون موقع',
          ),
          findsOneWidget,
        );
        expectNoOverflow(tester);
      });
    }

    testWidgets('a cut map answer reads the missing clients', (tester) async {
      mapJson['truncated'] = true;
      await pumpScreen(
        tester,
        const DeliveriesScreen(tabPath: '/livreur/deliveries'),
        locale: 'fr',
        user: livreur(),
      );
      await openMap(tester);
      expect(find.byKey(const ValueKey('delivery-c3')), findsOneWidget);
      expect(adapter.sent.where((r) => r.path == '/clients/c3'), hasLength(1));
    });

    testWidgets('the sheet lists the orders and Livrer opens one', (
      tester,
    ) async {
      OrderSummary? delivered;
      String? openedClient;
      await pumpScreen(
        tester,
        DeliveriesScreen(
          tabPath: '/livreur/deliveries',
          onOpenOrder: (context, order) async {
            delivered = order;
            return null;
          },
          onOpenClient: (context, id) async {
            openedClient = id;
            return null;
          },
        ),
        locale: 'fr',
        user: livreur(),
      );
      await openMap(tester);
      await tester.tap(find.byKey(const ValueKey('delivery-c1')));
      await tester.pumpAndSettle();
      expect(find.byType(ClientMapSheet), findsOneWidget);
      expect(find.text('Commandes à livrer'), findsOneWidget);
      expect(find.text('Livrer'), findsNWidgets(2));
      expect(find.text('Naviguer'), findsOneWidget);
      expectNoOverflow(tester);
      await tester.tap(find.text('Livrer').last);
      await tester.pumpAndSettle();
      expect(find.byType(ClientMapSheet), findsNothing);
      expect(delivered?.id, 'o2');

      await tester.tap(find.byKey(const ValueKey('delivery-c2')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ouvrir la fiche'));
      await tester.pumpAndSettle();
      expect(openedClient, 'c2');
    });

    testWidgets('the toggle keeps the list', (tester) async {
      await pumpScreen(
        tester,
        const DeliveriesScreen(tabPath: '/livreur/deliveries'),
        locale: 'fr',
        user: livreur(),
      );
      final orderCalls = adapter.sent.where((r) => r.path == '/orders').length;
      await openMap(tester);
      await tester.tap(find.byIcon(Icons.view_list_outlined));
      await tester.pumpAndSettle();
      expect(find.byType(DeliveryTile), findsWidgets);
      expect(adapter.sent.where((r) => r.path == '/orders').length, orderCalls);
    });

    testWidgets('without GEO_CHECK there is no map', (tester) async {
      await pumpScreen(
        tester,
        const DeliveriesScreen(tabPath: '/livreur/deliveries'),
        locale: 'fr',
        user: livreur(features: const ['MOBILE_APP', 'TOURNEES']),
      );
      expect(find.byType(MapListToggle), findsNothing);
      expect(find.byType(DeliveryTile), findsWidgets);
      expect(adapter.sent.where((r) => r.path == '/clients/map'), isEmpty);
    });
  });
}
