import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/truck/data/models/me_day.dart';
import 'package:orvynt_starter/features/truck/data/truck_repository.dart';
import 'package:orvynt_starter/features/truck/ui/truck_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> meDayJson({bool closed = false, bool truck = true}) => {
  'day': '2026-11-22',
  'vehicle': truck
      ? {'id': 'v1', 'code': 'CAM-01', 'name': 'Hyundai HD35', 'wilayaCode': 16}
      : null,
  'session': {
    'id': 's1',
    'seller': {'id': 'seller-1', 'fullName': 'Karim Vendeur'},
    'date': '2026-11-22',
    'status': closed ? 'CLOSED' : 'OPEN',
    'warehouse': {'id': 'v1', 'name': 'Hyundai HD35'},
    'expected': {
      'fromSales': '12500.00',
      'fromVersements': '3000.00',
      'total': '15500.00',
    },
    'handedCash': closed ? '15000.00' : null,
    'ecart': closed ? '-500.00' : null,
    'note': null,
    'closedBy': null,
    'closedAt': closed ? '2026-11-22T17:00:00.000Z' : null,
    'adjustments': <Object>[],
  },
  'expected': {
    'fromSales': '12500.00',
    'fromVersements': '3000.00',
    'total': '15500.00',
  },
  'stock': truck
      ? [
          {
            'productId': 'p1',
            'reference': 'EAU-15',
            'designation': 'Eau minérale 1,5 L',
            'unitId': 'u-pce',
            'unitCode': 'PCE',
            'qtyBase': '96.000',
          },
          {
            'productId': 'p2',
            'reference': 'JUS-1',
            'designation': 'Jus d\'orange 1 L pack familial',
            'unitId': 'u-pce',
            'unitCode': 'PCE',
            'qtyBase': '12.500',
          },
        ]
      : <Object>[],
  'transfers': truck
      ? [
          {
            'id': 't1',
            'number': 'TR-2026-000031',
            'type': 'LOAD',
            'validatedAt': '2026-11-22T06:30:00.000Z',
            'from': {'id': 'd1', 'name': 'Dépôt principal'},
            'to': {'id': 'v1', 'name': 'Hyundai HD35'},
            'lines': [
              {
                'productId': 'p1',
                'reference': 'EAU-15',
                'designation': 'Eau minérale 1,5 L',
                'unitId': 'u-crt',
                'unitCode': 'CRT',
                'qty': '5.000',
                'qtyBase': '120.000',
              },
            ],
          },
        ]
      : <Object>[],
};

void main() {
  test('MeDayDto decodes quantities and cash as Decimal', () {
    final day = MeDay.fromJson(meDayJson(closed: true));
    expect(day.vehicle!.label, 'CAM-01 · Hyundai HD35');
    expect(day.expected.total, Decimal.parse('15500'));
    expect(day.session!.isOpen, isFalse);
    expect(day.session!.ecart, Decimal.parse('-500'));
    expect(day.stock[1].qtyBase, Decimal.parse('12.5'));
    expect(day.transfers.single.isLoad, isTrue);
    expect(day.transfers.single.lines.single.qtyBase, Decimal.fromInt(120));
  });

  test('a day without a truck decodes', () {
    final day = MeDay.fromJson({...meDayJson(truck: false), 'session': null});
    expect(day.vehicle, isNull);
    expect(day.session, isNull);
    expect(day.stock, isEmpty);
  });

  group('screen at 360 dp', () {
    late Map<String, dynamic> body;
    setUp(() {
      body = meDayJson();
      final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))
        ..httpClientAdapter = FakeAdapter((_) => FakeReply(200, body));
      getIt.registerSingleton<TruckRepository>(
        TruckRepository(ApiClient(dio: dio)),
      );
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('my truck in $locale', (tester) async {
        await pumpScreen(tester, const TruckScreen(), locale: locale);
        expect(find.text('CAM-01 · Hyundai HD35'), findsOneWidget);
        expectNoOverflow(tester);
        await tester.drag(find.byType(ListView).first, const Offset(0, -250));
        await tester.pumpAndSettle();
        expect(find.text('Eau minérale 1,5 L'), findsOneWidget);
        await tester.drag(find.byType(ListView).first, const Offset(0, -800));
        await tester.pumpAndSettle();
        expect(find.textContaining('TR-2026-000031'), findsOneWidget);
        // Read only: no chargement entry without STOCK_TRANSFER.
        expect(
          find.byIcon(Icons.move_to_inbox_outlined),
          findsOneWidget,
        ); // the LOAD tile icon only
        expectNoOverflow(tester);
      });
    }

    testWidgets('a livreur\'s cash comes from his deliveries', (tester) async {
      await pumpScreen(
        tester,
        const TruckScreen(),
        locale: 'fr',
        user: livreur(),
      );
      expect(find.text('Des livraisons'), findsOneWidget);
      expect(find.text('Des ventes'), findsNothing);
      expectNoOverflow(tester);
    });

    testWidgets('a closed day shows the écart', (tester) async {
      body = meDayJson(closed: true);
      await pumpScreen(tester, const TruckScreen(), locale: 'fr');
      expect(find.text('Journée clôturée'), findsOneWidget);
      expect(find.text('Écart'), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('STOCK_TRANSFER granted: the chargement entries show', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const TruckScreen(),
        locale: 'fr',
        user: seller(
          permissions: const [Permission.salesCreate, Permission.stockTransfer],
        ),
      );
      await tester.drag(find.byType(ListView).first, const Offset(0, -800));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('my-truck-new-load')), findsOneWidget);
      expect(find.byKey(const Key('my-truck-loads')), findsOneWidget);
      expect(find.text('Nouveau chargement'), findsOneWidget);
      expectNoOverflow(tester);
    });

    for (final user in [seller(), livreur()]) {
      testWidgets('${user.role} without the grant: no Nouveau chargement', (
        tester,
      ) async {
        await pumpScreen(tester, const TruckScreen(), locale: 'fr', user: user);
        await tester.drag(find.byType(ListView).first, const Offset(0, -800));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('my-truck-new-load')), findsNothing);
        expect(find.text('Nouveau chargement'), findsNothing);
      });
    }
  });
}
