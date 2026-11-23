import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/map/client_map_repository.dart';
import 'package:orvynt_starter/core/map/client_map_sheet.dart';
import 'package:orvynt_starter/core/map/client_marker.dart';
import 'package:orvynt_starter/core/map/map_list_toggle.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/today/data/models/today.dart';
import 'package:orvynt_starter/features/today/data/repo/today_repository.dart';
import 'package:orvynt_starter/features/today/ui/today_map.dart';
import 'package:orvynt_starter/features/today/ui/today_screen.dart';

import '../../core/map/map_core_test.dart' show mapPoint;
import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> _stop(
  int n,
  String name, {
  String balance = '0.00',
  bool visited = false,
  bool located = true,
}) => {
  'routeId': 'r1',
  'position': n,
  'client': {
    'id': 'c$n',
    'code': 'CL-00$n',
    'name': name,
    'phone': '0550000000',
    'address': null,
    'commune': 'Bab Ezzouar',
    'lat': located ? _lat(n) : null,
    'lng': located ? _lng(n) : null,
  },
  'balance': balance,
  'lastVisit': null,
  'lastSale': null,
  'visitedToday': visited,
  'today': {'saleId': null, 'orderId': null, 'paymentId': null},
};

// Located stops (1-3, 7-14) on a 0.05° grid: markers never overlap at the
// fitted zoom, so a tap hits the one it aims at.
int _k(int n) => n <= 3 ? n - 1 : n - 4;
double _lat(int n) => 36.6 + (_k(n) % 3) * 0.05;
double _lng(int n) => 3.0 + (_k(n) ~/ 3) * 0.05;

/// 3 stops on the map (one visited, one over its plafond), 3 without a point,
/// and enough stops for the list to scroll.
final _day = <String, dynamic>{
  'day': '2026-11-23',
  'weekday': 1,
  'vehicle': null,
  'routes': [
    {'id': 'r1', 'name': 'Bab Ezzouar Nord'},
  ],
  'stops': [
    _stop(1, 'Supérette El Baraka', balance: '45230.50', visited: true),
    _stop(2, 'Alimentation Benali', balance: '1200.00'),
    _stop(3, 'Épicerie du Centre', balance: '99000.00'),
    _stop(4, 'Kiosque Sans Point A', located: false),
    _stop(5, 'Kiosque Sans Point B', located: false),
    _stop(6, 'Kiosque Sans Point C', located: false),
    for (var n = 7; n <= 14; n++) _stop(n, 'Client $n'),
  ],
  'planned': 14,
  'visited': 1,
};

void main() {
  late FakeAdapter adapter;
  late Map<String, dynamic> mapJson;

  setUp(() {
    mapJson = {
      'points': [
        mapPoint(
          'c3',
          'Épicerie du Centre',
          balance: '99000.00',
          overLimit: true,
        ),
        mapPoint(
          'x1',
          'Grossiste Voisin',
          balance: '10.00',
          lat: 36.625,
          lng: 3.025,
        ),
        mapPoint('x2', 'Dépôt Est', lat: 36.675, lng: 3.075),
      ],
      'truncated': false,
      'withoutLocation': 0,
    };
    adapter = FakeAdapter(
      (o) => o.path == '/clients/map'
          ? FakeReply(200, mapJson)
          : FakeReply(200, _day),
    );
    final api = ApiClient(
      dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
        ..httpClientAdapter = adapter,
    );
    getIt.registerSingleton<TodayRepository>(TodayRepository(api));
    getIt.registerSingleton<ClientMapRepository>(ClientMapRepository(api));
  });
  tearDown(() => getIt.reset());

  Future<void> openMap(WidgetTester tester) async {
    await tester.tap(find.byIcon(Icons.map_outlined));
    await tester.pumpAndSettle();
  }

  MarkerState stateOf(WidgetTester tester, String key) =>
      tester.widget<ClientMarker>(find.byKey(ValueKey(key))).state;

  for (final locale in ['ar', 'fr']) {
    testWidgets('the day on the map in $locale', (tester) async {
      await pumpScreen(tester, const TodayScreen(), locale: locale);
      expect(find.byType(MapListToggle), findsOneWidget);
      await openMap(tester);
      expect(find.byType(TodayMap), findsOneWidget);
      // Numbered in route order; the visited one shows a check.
      expect(find.byKey(const ValueKey('stop-c1')), findsOneWidget);
      expect(find.byKey(const ValueKey('stop-c2')), findsOneWidget);
      expect(find.byKey(const ValueKey('stop-c3')), findsOneWidget);
      expect(find.byKey(const ValueKey('stop-c4')), findsNothing);
      expect(stateOf(tester, 'stop-c1'), MarkerState.visited);
      expect(stateOf(tester, 'stop-c2'), MarkerState.debt);
      // /me/today has no plafond: the map's answer makes c3 red.
      expect(stateOf(tester, 'stop-c3'), MarkerState.overLimit);
      expect(
        find.textContaining(
          locale == 'fr' ? 'Clients sans position' : 'زبائن بدون موقع',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('3'), findsWidgets);
      expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
      expectNoOverflow(tester);
    });
  }

  testWidgets('"sans position" lists the stops without a point', (
    tester,
  ) async {
    await pumpScreen(tester, const TodayScreen(), locale: 'fr');
    await openMap(tester);
    expect(find.text('Kiosque Sans Point B'), findsNothing);
    await tester.tap(find.textContaining('Clients sans position'));
    await tester.pumpAndSettle();
    expect(find.text('Kiosque Sans Point A'), findsOneWidget);
    expect(find.text('Kiosque Sans Point B'), findsOneWidget);
    expect(find.text('Kiosque Sans Point C'), findsOneWidget);
    expectNoOverflow(tester);
  });

  testWidgets('the toggle keeps the list where it was', (tester) async {
    await pumpScreen(tester, const TodayScreen(), locale: 'fr');
    final list = find.byType(Scrollable).first;
    await tester.drag(list, const Offset(0, -400));
    await tester.pumpAndSettle();
    final offset = tester.state<ScrollableState>(list).position.pixels;
    expect(offset, greaterThan(0));
    final todayCalls = adapter.sent.where((r) => r.path == '/me/today').length;

    await openMap(tester);
    await tester.tap(find.byIcon(Icons.view_list_outlined));
    await tester.pumpAndSettle();

    expect(
      tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position
          .pixels,
      offset,
    );
    // Switching does not reload the day.
    expect(adapter.sent.where((r) => r.path == '/me/today').length, todayCalls);
  });

  testWidgets('the Clients layer adds the other clients', (tester) async {
    await pumpScreen(tester, const TodayScreen(), locale: 'fr');
    await openMap(tester);
    expect(find.byKey(const ValueKey('client-x1')), findsNothing);
    await tester.tap(find.text('Clients'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('client-x1')), findsOneWidget);
    expect(find.byKey(const ValueKey('client-x2')), findsOneWidget);
    // A stop is not drawn twice.
    expect(find.byKey(const ValueKey('client-c3')), findsNothing);
    await tester.tap(find.text('Clients'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('client-x1')), findsNothing);
  });

  testWidgets('above the cap it asks to zoom in', (tester) async {
    mapJson['truncated'] = true;
    await pumpScreen(tester, const TodayScreen(), locale: 'fr');
    await openMap(tester);
    expect(find.text('Zoomez pour voir tous les clients'), findsNothing);
    await tester.tap(find.text('Clients'));
    await tester.pumpAndSettle();
    expect(find.text('Zoomez pour voir tous les clients'), findsOneWidget);
    expectNoOverflow(tester);
  });

  testWidgets('a stop opens its sheet, then the client', (tester) async {
    TodayStop? opened;
    await pumpScreen(
      tester,
      TodayScreen(
        onOpenClient: (context, stop) async {
          opened = stop;
          return null;
        },
      ),
      locale: 'fr',
    );
    await openMap(tester);
    await tester.tap(find.byKey(const ValueKey('stop-c2')));
    await tester.pumpAndSettle();
    expect(find.byType(ClientMapSheet), findsOneWidget);
    expect(find.text('Alimentation Benali'), findsWidgets);
    expect(find.text('Appeler'), findsOneWidget);
    expect(find.text('Naviguer'), findsOneWidget);
    expectNoOverflow(tester);
    await tester.tap(find.text('Ouvrir la fiche'));
    await tester.pumpAndSettle();
    expect(opened?.client.id, 'c2');
  });

  testWidgets('a layer client opens by id', (tester) async {
    String? opened;
    await pumpScreen(
      tester,
      TodayScreen(
        onOpenClientId: (context, id) async {
          opened = id;
          return null;
        },
      ),
      locale: 'fr',
    );
    await openMap(tester);
    await tester.tap(find.text('Clients'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('client-x2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ouvrir la fiche'));
    await tester.pumpAndSettle();
    expect(opened, 'x2');
  });

  testWidgets('without GEO_CHECK there is no map', (tester) async {
    await pumpScreen(
      tester,
      const TodayScreen(),
      locale: 'fr',
      user: seller(features: const ['MOBILE_APP', 'TOURNEES']),
    );
    expect(find.byType(MapListToggle), findsNothing);
    expect(find.byIcon(Icons.map_outlined), findsNothing);
    expect(find.byType(StopTile), findsWidgets);
    expect(adapter.sent.where((r) => r.path == '/clients/map'), isEmpty);
  });
}
