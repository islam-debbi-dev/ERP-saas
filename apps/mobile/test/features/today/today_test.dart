import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/today/data/models/today.dart';
import 'package:orvynt_starter/features/today/data/repo/today_repository.dart';
import 'package:orvynt_starter/features/today/ui/today_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> stop(
  int position,
  String name,
  String balance, {
  bool visited = false,
}) => {
  'routeId': 'r1',
  'position': position,
  'client': {
    'id': 'c$position',
    'code': 'CL-00$position',
    'name': name,
    'phone': '0550000000',
    'address': null,
    'commune': 'Bab Ezzouar',
    'lat': 36.7,
    'lng': 3.1,
  },
  'balance': balance,
  'lastVisit': null,
  'lastSale': {
    'id': 's1',
    'number': 'BL-2026-000012',
    'totalTtc': '12500.00',
    'validatedAt': '2026-11-21T10:00:00.000Z',
  },
  'visitedToday': visited,
  'today': {'saleId': null, 'orderId': null, 'paymentId': null},
};

final todayJson = <String, dynamic>{
  'day': '2026-11-22',
  'weekday': 0,
  'vehicle': {
    'id': 'v1',
    'code': 'CAM-01',
    'name': 'Hyundai HD35',
    'wilayaCode': 16,
  },
  'routes': [
    {'id': 'r1', 'name': 'Bab Ezzouar Nord'},
  ],
  'stops': [
    stop(1, 'Supérette El Baraka', '45230.50', visited: true),
    stop(2, 'Alimentation Générale Benali et Fils Grossiste Détail', '0.00'),
    stop(3, 'Épicerie du Centre', '-1200.00'),
  ],
  'planned': 3,
  'visited': 1,
};

void main() {
  test('TodayDto decodes with Decimal balances and the truck label', () {
    final today = Today.fromJson(todayJson);
    expect(today.vehicle!.label, 'CAM-01 · Hyundai HD35');
    expect(today.stops, hasLength(3));
    expect(today.stops.first.balance, Decimal.parse('45230.50'));
    expect(today.stops.first.lastSale!.totalTtc, Decimal.parse('12500'));
    expect(today.stops.first.visitedToday, isTrue);
    expect(today.routes.single.name, 'Bab Ezzouar Nord');
  });

  test('a day without a truck decodes', () {
    final today = Today.fromJson({
      ...todayJson,
      'vehicle': null,
      'stops': <Object>[],
      'routes': <Object>[],
    });
    expect(today.vehicle, isNull);
    expect(today.stops, isEmpty);
  });

  group('TodayScreen at 360 dp', () {
    setUp(() {
      final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))
        ..httpClientAdapter = FakeAdapter((_) => FakeReply(200, todayJson));
      getIt.registerSingleton<TodayRepository>(
        TodayRepository(ApiClient(dio: dio)),
      );
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('shows the truck, progress and stops in $locale', (
        tester,
      ) async {
        await pumpScreen(tester, const TodayScreen(), locale: locale);
        expect(find.text('CAM-01 · Hyundai HD35'), findsOneWidget);
        expect(find.text('Supérette El Baraka'), findsOneWidget);
        expect(find.byType(StopTile), findsNWidgets(3));
        expect(find.byIcon(Icons.check_rounded), findsOneWidget);
        expectNoOverflow(tester);
      });
    }

    testWidgets('without TOURNEES points to the clients', (tester) async {
      await pumpScreen(
        tester,
        const TodayScreen(),
        locale: 'fr',
        user: seller(features: const ['MOBILE_APP']),
      );
      expect(find.text('Tournées non activées'), findsOneWidget);
      expectNoOverflow(tester);
    });
  });
}
