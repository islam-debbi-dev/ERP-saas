import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/geo/geo_fix.dart';
import 'package:orvynt_starter/core/helpers/algiers_day.dart';
import 'package:orvynt_starter/core/helpers/phone_links.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/paging/paged_cubit.dart';
import 'package:orvynt_starter/features/clients/data/models/client.dart';
import 'package:orvynt_starter/features/clients/data/repo/clients_repository.dart';
import 'package:orvynt_starter/features/clients/logic/clients_list_cubit.dart';
import 'package:orvynt_starter/features/clients/ui/client_detail_screen.dart';
import 'package:orvynt_starter/features/clients/ui/clients_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_app.dart';

final fix = GeoFix(
  lat: 36.72,
  lng: 3.18,
  accuracyM: 12.5,
  capturedAt: DateTime.utc(2026, 11, 22, 9, 30),
);

(ClientsRepository, FakeAdapter) repoWith(
  FakeReply Function(RequestOptions) h,
) {
  final adapter = FakeAdapter(h);
  final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))
    ..httpClientAdapter = adapter;
  return (ClientsRepository(ApiClient(dio: dio)), adapter);
}

FakeReply defaultApi(RequestOptions o) {
  if (o.method == 'GET' && o.path == '/clients') {
    return FakeReply(200, {
      'items': [
        clientJson(),
        clientJson(
          id: 'c2',
          name: 'Épicerie du Centre',
          balance: '0.00',
          creditLimit: null,
        ),
      ],
      'nextCursor': null,
    });
  }
  if (o.path == '/clients/nearby') {
    return FakeReply(200, [
      {
        'id': 'c3',
        'code': 'CL-003',
        'name': 'Kiosque Amine',
        'commune': null,
        'phone': null,
        'lat': 36.7,
        'lng': 3.1,
        'active': true,
        'balance': '1200.00',
        'overLimit': false,
        'sectorId': null,
        'assignedSellerId': null,
        'distanceM': 1450,
      },
    ]);
  }
  if (o.path == '/clients/c1') return FakeReply(200, clientJson());
  if (o.path == '/clients/c1/unpaid-documents') {
    return FakeReply(200, [unpaidJson()]);
  }
  if (o.path == '/sales') {
    return FakeReply(200, {
      'items': [saleSummaryJson()],
      'nextCursor': null,
    });
  }
  return const FakeReply(404, {'code': 'NOT_FOUND', 'message': 'nope'});
}

void main() {
  group('models', () {
    test('client decodes balance and plafond as Decimal', () {
      final c = Client.fromJson(clientJson());
      expect(c.balance, Decimal.parse('45230.5'));
      expect(c.creditLimit, Decimal.parse('50000'));
      expect(c.creditLeft, Decimal.parse('4769.5'));
      expect(c.version, 3);
    });

    test('credit left is never negative and null without a plafond', () {
      expect(
        Client.fromJson(clientJson(balance: '60000.00')).creditLeft,
        Decimal.zero,
      );
      expect(Client.fromJson(clientJson(creditLimit: null)).creditLeft, isNull);
    });

    test('a nearby point keeps its distance', () {
      final r = ClientRow.fromNearby({
        'id': 'c3',
        'code': 'X',
        'name': 'N',
        'balance': '-10.00',
        'distanceM': 812.6,
      });
      expect(r.distanceM, 813);
      expect(r.balance, Decimal.parse('-10'));
    });

    test('unpaid document amounts are Decimal', () {
      final d = UnpaidDocument.fromJson(unpaidJson());
      expect(d.remaining, Decimal.parse('20000'));
      expect(d.totalTtc - d.paid - d.returned, d.remaining);
    });
  });

  group('ClientsListCubit', () {
    test('debtors, search and near me each reload with their query', () async {
      final (repo, api) = repoWith(defaultApi);
      final cubit = ClientsListCubit(repo);
      await cubit.start();
      expect(cubit.state.items, hasLength(2));
      expect(api.sent.last.path, '/clients');

      await cubit.toggleDebtors();
      expect(api.sent.last.method, 'GET');
      await cubit.search('baraka');

      await cubit.nearMe(fix);
      final near = api.sent.last;
      expect(near.method, 'POST');
      expect(near.path, '/clients/nearby');
      final body = near.body as Map<String, dynamic>;
      expect(body['lat'], 36.72);
      expect(body['hasDebt'], isTrue);
      expect(body['search'], 'baraka');
      expect(cubit.state.items.single.distanceM, 1450);
      expect(cubit.state.hasMore, isFalse);

      await cubit.nearMe(null);
      expect(api.sent.last.path, '/clients');
      expect(cubit.state.status, PagedStatus.ready);
      await cubit.close();
    });

    test('the list query carries hasDebt and the search text', () async {
      final queries = <Map<String, dynamic>>[];
      final (repo, _) = repoWith((o) {
        queries.add(o.queryParameters);
        return defaultApi(o);
      });
      final cubit = ClientsListCubit(repo);
      await cubit.start();
      await cubit.toggleDebtors();
      await cubit.search('  ali ');
      expect(queries.first.containsKey('hasDebt'), isFalse);
      expect(queries[1]['hasDebt'], 'true');
      expect(queries[2]['search'], 'ali');
      await cubit.close();
    });
  });

  group('helpers', () {
    test('geo input is all four position fields or none', () {
      final full = geoInputJson(fix);
      expect(
        full.keys,
        containsAll(['lat', 'lng', 'accuracyM', 'capturedAt', 'isMocked']),
      );
      expect(full['capturedAt'], '2026-11-22T09:30:00.000Z');
      final none = geoInputJson(null, note: '  pas de réseau ');
      expect(none, {'isMocked': false, 'note': 'pas de réseau'});
    });

    test('WhatsApp numbers go international', () {
      expect(PhoneLinks.whatsappNumber('0550 12 34 56'), '213550123456');
      expect(PhoneLinks.whatsappNumber('+213 661-00-11-22'), '213661001122');
      expect(PhoneLinks.whatsappNumber('abc'), isNull);
    });

    test('the Algiers day turns at 23:00 UTC', () {
      expect(AlgiersDay.of(DateTime.utc(2026, 11, 22, 22, 59)), '2026-11-22');
      expect(AlgiersDay.of(DateTime.utc(2026, 11, 22, 23, 0)), '2026-11-23');
      expect(AlgiersDay.display('2026-11-05'), '05/11/2026');
    });
  });

  group('screens at 360 dp', () {
    setUp(() {
      final (repo, _) = repoWith(defaultApi);
      getIt.registerSingleton<ClientsRepository>(repo);
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('client list in $locale', (tester) async {
        await pumpScreen(
          tester,
          const ClientsScreen(basePath: '/seller/clients'),
          locale: locale,
        );
        expect(find.byType(ClientTile), findsNWidgets(2));
        expect(find.text('Supérette El Baraka'), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('client detail in $locale', (tester) async {
        await pumpScreen(
          tester,
          const ClientDetailScreen(
            clientId: 'c1',
            basePath: '/seller/clients/c1',
          ),
          locale: locale,
        );
        // The action buttons push the documents below the fold.
        await tester.drag(find.byType(ListView).first, const Offset(0, -300));
        await tester.pumpAndSettle();
        expect(find.text('BL-2026-000101'), findsOneWidget);
        await tester.drag(find.byType(ListView).first, const Offset(0, -600));
        await tester.pumpAndSettle();
        expect(find.text('BL-2026-000120'), findsOneWidget);
        expectNoOverflow(tester);
      });
    }
  });
}
