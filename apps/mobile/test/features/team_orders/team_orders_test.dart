import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/core/router/tab_badges.dart';
import 'package:orvynt_starter/features/delivery/ui/deliveries_screen.dart';
import 'package:orvynt_starter/features/orders/data/models/order.dart';
import 'package:orvynt_starter/features/orders/data/repo/orders_repository.dart';
import 'package:orvynt_starter/features/team/data/team_repository.dart';
import 'package:orvynt_starter/features/team_orders/data/team_orders_repository.dart';
import 'package:orvynt_starter/features/team_orders/ui/assign_sheet.dart';
import 'package:orvynt_starter/features/team_orders/ui/team_orders_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import '../team/team_fixtures.dart';

Map<String, dynamic> orderJson(
  String id,
  String clientId,
  String clientName, {
  Map<String, dynamic>? livreur,
  Map<String, dynamic>? truck,
}) => {
  'id': id,
  'number': 'BC-2026-00000$id',
  'status': 'CONFIRMED',
  'client': {'id': clientId, 'code': 'CL-$clientId', 'name': clientName},
  'seller': {'id': 'u1', 'fullName': 'Karim Vendeur'},
  'livreur': livreur,
  'deliveryVehicle': truck,
  'requestedDate': '2026-11-23',
  'totalTtc': '28560.00',
  'lineCount': 3,
  'shortLines': 0,
  'sale': null,
  'createdAt': '2026-11-22T09:00:00.000Z',
};

List<Map<String, dynamic>> ordersJson() => [
  orderJson('1', 'c1', 'Supérette El Baraka'),
  orderJson('2', 'c9', 'Alimentation Générale Benali et Fils Grossiste Détail'),
  orderJson(
    '3',
    'c1',
    'Supérette El Baraka',
    livreur: {'id': 'u9', 'fullName': 'Yacine Chauffeur'},
    truck: {'id': 'v2', 'code': 'CAM-16 LIV 02', 'name': 'Isuzu NPR'},
  ),
];

/// Orders, deliverers (one outside the team) and the team of today.
FakeAdapter ordersApi({FakeReply Function(RequestOptions o)? onPatch}) {
  final team = teamApi();
  return FakeAdapter((o) {
    if (o.method == 'PATCH') {
      return onPatch?.call(o) ??
          FakeReply(200, {
            ...orderJson('1', 'c1', 'Supérette El Baraka'),
            'lines': <Object>[],
            'totalHt': '24000.00',
            'totalTva': '4560.00',
            'version': 2,
          });
    }
    if (o.path == '/orders') {
      return FakeReply(200, {'items': ordersJson(), 'nextCursor': null});
    }
    if (o.path == '/orders/deliverers') {
      return const FakeReply(200, [
        {'id': 'u3', 'fullName': 'Samir Livreur', 'role': 'LIVREUR'},
        {'id': 'u1', 'fullName': 'Karim Vendeur', 'role': 'SELLER'},
        {'id': 'x7', 'fullName': 'Vendeur Autre Équipe', 'role': 'SELLER'},
      ]);
    }
    return team.handler(o);
  });
}

TeamOrdersRepository repoFor(FakeAdapter a) {
  final api = apiWith(a);
  return TeamOrdersRepository(
    api,
    OrdersRepository(api),
    TeamRepository(api),
    clock: () => DateTime.utc(2026, 11, 22, 10),
  );
}

void main() {
  test('confirmed orders split into to assign and assigned', () async {
    final r = await repoFor(ordersApi()).board();
    final board = (r as Success<TeamOrdersBoard>).data;
    expect(board.toAssign.count, 2);
    expect(board.assigned.count, 1);
    expect(
      board.toAssign.groups.map((g) => g.clientName).first,
      'Alimentation Générale Benali et Fils Grossiste Détail',
    );
  });

  test(
    'a deliverer outside the API team is never offered; delivery trucks first',
    () async {
      final api = ordersApi();
      final r = await repoFor(api).options();
      final options = (r as Success<AssignOptions>).data;
      expect(options.deliverers.map((d) => d.id), ['u3', 'u1']);
      expect(options.trucks.first.id, 'v2');
      expect(options.trucks.first.isDelivery, isTrue);
      final teamCall = api.sent.singleWhere(
        (s) => s.path == '/seller-sessions',
      );
      expect(teamCall.query['date'], '2026-11-22');
    },
  );

  test('a truck or a person: the PATCH names one of them', () async {
    final api = ordersApi();
    final repo = repoFor(api);
    await repo.assignToTruck('1', 'v2');
    await repo.assignToPerson('1', 'u3');
    final patches = api.sent.where((s) => s.method == 'PATCH').toList();
    expect(patches.map((p) => p.path), [
      '/orders/1/livreur',
      '/orders/1/livreur',
    ]);
    expect(patches[0].body, {'deliveryVehicleId': 'v2'});
    expect(patches[1].body, {'livreurId': 'u3'});
  });

  test('isUnassigned needs neither a livreur nor a truck', () {
    final o = OrderSummary.fromJson(ordersJson()[2]);
    expect(o.isUnassigned, isFalse);
    expect(o.livreur!.fullName, 'Yacine Chauffeur');
    expect(OrderSummary.fromJson(ordersJson()[0]).isUnassigned, isTrue);
  });

  group('screens at 360 dp', () {
    late FakeAdapter api;
    setUp(() {
      api = ordersApi();
      getIt.registerSingleton<TeamOrdersRepository>(repoFor(api));
    });
    tearDown(() {
      getIt.reset();
      TabBadges.reset();
    });

    for (final locale in ['ar', 'fr']) {
      testWidgets('orders to assign and assigned in $locale', (tester) async {
        await pumpScreen(
          tester,
          const TeamOrdersScreen(tabPath: '/supervisor/orders'),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byType(DeliveryTile), findsNWidgets(2));
        expect(TabBadges.of('/supervisor/orders').value, 2);
        expectNoOverflow(tester);
        await tester.tap(find.textContaining('(1)'));
        await tester.pumpAndSettle();
        expect(find.byType(DeliveryTile), findsOneWidget);
        expect(find.textContaining('Yacine Chauffeur'), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('assign sheet: put an order on a truck in $locale', (
        tester,
      ) async {
        await pumpScreen(
          tester,
          const TeamOrdersScreen(tabPath: '/supervisor/orders'),
          locale: locale,
          user: supervisor(),
        );
        await tester.tap(find.byType(DeliveryTile).first);
        await tester.pumpAndSettle();
        expect(find.byType(AssignSheet), findsOneWidget);
        expect(find.text('Samir Livreur'), findsOneWidget);
        expect(find.text('Vendeur Autre Équipe'), findsNothing);
        expectNoOverflow(tester);
        await tester.tap(find.text('CAM-16 LIV 02 · Isuzu NPR'));
        await tester.pumpAndSettle();
        expect(find.byType(AssignSheet), findsNothing);
        expect(find.byType(SnackBar), findsOneWidget);
        final patch = api.sent.singleWhere((s) => s.method == 'PATCH');
        expect(patch.body, {'deliveryVehicleId': 'v2'});
        expectNoOverflow(tester);
      });

      testWidgets('a refused assignment stays in the sheet in $locale', (
        tester,
      ) async {
        await getIt.unregister<TeamOrdersRepository>();
        api = ordersApi(
          onPatch: (_) => const FakeReply(409, {
            'code': 'ORDER_NOT_CONFIRMED',
            'message': 'no',
          }),
        );
        getIt.registerSingleton<TeamOrdersRepository>(repoFor(api));
        await pumpScreen(
          tester,
          const TeamOrdersScreen(tabPath: '/supervisor/orders'),
          locale: locale,
          user: supervisor(),
        );
        await tester.tap(find.byType(DeliveryTile).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Samir Livreur'));
        await tester.pumpAndSettle();
        expect(find.byType(AssignSheet), findsOneWidget);
        expect(find.byType(SnackBar), findsNothing);
        expectNoOverflow(tester);
      });
    }
  });
}
