import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/geo/geo_fix.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/core/network/money_action.dart';
import 'package:orvynt_starter/features/clients/data/models/client.dart';
import 'package:orvynt_starter/features/clients/data/repo/clients_repository.dart';
import 'package:orvynt_starter/features/payments/data/repo/payments_repository.dart';
import 'package:orvynt_starter/features/payments/logic/versement_cubit.dart';
import 'package:orvynt_starter/features/payments/logic/versement_form.dart';
import 'package:orvynt_starter/features/payments/ui/versement_screen.dart';
import 'package:orvynt_starter/features/sales/logic/basket.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_app.dart';

Decimal d(String v) => Decimal.parse(v);
final unpaid = [UnpaidDocument.fromJson(unpaidJson())]; // remaining 20000
final fix = GeoFix(
  lat: 36.7,
  lng: 3.1,
  accuracyM: 10,
  capturedAt: DateTime.utc(2026, 11, 22, 10),
);

Map<String, dynamic> paymentJson() => {
  'id': 'pay-1',
  'number': 'VER-2026-000077',
  'client': {'id': 'c1', 'code': 'CL-001', 'name': 'Supérette El Baraka'},
  'sale': null,
  'amount': '15000.00',
  'mode': 'CHEQUE',
  'status': 'VALID',
  'reference': '4455667',
  'bank': 'BNA',
  'dueDate': '2026-12-15',
  'note': null,
  'receivedBy': null,
  'collectedBy': {'id': 'seller-1', 'fullName': 'Karim Vendeur'},
  'receivedAt': '2026-11-22T10:00:00.000Z',
  'cancelReason': null,
  'cancelledAt': null,
  'bounceReason': null,
  'bouncedAt': null,
  'allocations': [
    {
      'saleId': 's9',
      'saleNumber': 'BL-2026-000101',
      'saleType': 'BL',
      'amount': '15000.00',
    },
  ],
  'version': 1,
  'geoCheck': {
    'id': 'g',
    'status': 'OK',
    'distanceM': 12,
    'flags': <Object>[],
    'offerSaveClientLocation': false,
  },
};

ApiClient clientWith(FakeAdapter a) => ApiClient(
  dio: Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = a,
);

void main() {
  group('form rules', () {
    test('an amount is required, positive, 2 decimals at most', () {
      expect(
        const VersementForm().errors(unpaid),
        contains('versement.error_amount'),
      );
      expect(
        VersementForm(amount: d('0')).errors(unpaid),
        contains('versement.error_amount'),
      );
      expect(
        VersementForm(amount: d('10.555')).errors(unpaid),
        contains('versement.error_amount'),
      );
      expect(VersementForm(amount: d('10.50')).errors(unpaid), isEmpty);
    });

    test('a cheque needs its number, bank and due date', () {
      final f = VersementForm(amount: d('100'), mode: PaymentModeValue.cheque);
      expect(
        f.errors(unpaid),
        containsAll([
          'versement.error_cheque_number',
          'versement.error_bank',
          'versement.error_due_date',
        ]),
      );
      final ok = f.copyWith(
        reference: '4455667',
        bank: 'BNA',
        dueDate: '2026-12-15',
      );
      expect(ok.errors(unpaid), isEmpty);
    });

    test('allocations stay within the document and the amount', () {
      final f = VersementForm(amount: d('15000'));
      expect(
        f.copyWith(allocations: {'s9': d('25000')}).errors(unpaid),
        contains('versement.error_allocation'),
      );
      expect(
        f.copyWith(allocations: {'unknown': d('10')}).errors(unpaid),
        contains('versement.error_allocation'),
      );
      expect(
        VersementForm(
          amount: d('5000'),
          allocations: {'s9': d('6000')},
        ).errors(unpaid),
        contains('versement.error_allocated_sum'),
      );
      expect(
        f.copyWith(allocations: {'s9': d('15000')}).errors(unpaid),
        isEmpty,
      );
    });

    test('the body follows createPaymentSchema', () {
      final f = VersementForm(
        amount: d('15000'),
        mode: PaymentModeValue.cheque,
        reference: ' 4455667 ',
        bank: 'BNA',
        dueDate: '2026-12-15',
        allocations: {'s9': d('15000')},
      );
      final body = f.toJson(clientId: 'c1', geo: fix);
      expect(body['amount'], '15000.00');
      expect(body['mode'], 'CHEQUE');
      expect(body['reference'], '4455667');
      expect(body['dueDate'], '2026-12-15');
      expect(body['allocations'], [
        {'saleId': 's9', 'amount': '15000.00'},
      ]);
      expect((body['geo'] as Map)['lat'], 36.7);
      final cash = VersementForm(
        amount: d('500'),
        dueDate: '2026-12-15',
      ).toJson(clientId: 'c1', geo: null);
      expect(cash['dueDate'], isNull);
      expect(cash.containsKey('allocations'), isFalse);
      expect(cash['geo'], {'isMocked': false});
    });
  });

  test('a versement retried after a timeout keeps its key', () async {
    var calls = 0;
    final api = FakeAdapter((o) {
      if (o.path.endsWith('unpaid-documents')) {
        return FakeReply(200, [unpaidJson()]);
      }
      calls++;
      return calls == 1
          ? const FakeReply.fail(DioExceptionType.sendTimeout)
          : FakeReply(201, paymentJson());
    });
    final client = clientWith(api);
    final cubit = VersementCubit(
      PaymentsRepository(client),
      ClientsRepository(client),
      clientId: 'c1',
    );
    await cubit.loadUnpaid();
    cubit.setAmount(d('15000'));
    const runner = MoneyActionRunner(askGeoNote: _never);
    expect(await cubit.submit(geo: fix, runner: runner), isNull);
    expect(cubit.state.error!.isOffline, isTrue);
    final p = await cubit.submit(geo: fix, runner: runner);
    expect(p!.number, 'VER-2026-000077');
    final posts = api.sent.where((r) => r.path == '/payments').toList();
    expect(posts, hasLength(2));
    expect(
      posts[1].headers[IdempotencyKey.header],
      posts[0].headers[IdempotencyKey.header],
    );
    await cubit.close();
  });

  test('an invalid form sends nothing and shows its errors', () async {
    final api = FakeAdapter((_) => const FakeReply(200, <Object>[]));
    final client = clientWith(api);
    final cubit = VersementCubit(
      PaymentsRepository(client),
      ClientsRepository(client),
      clientId: 'c1',
    );
    await cubit.submit(
      geo: null,
      runner: const MoneyActionRunner(askGeoNote: _never),
    );
    expect(cubit.state.showErrors, isTrue);
    expect(api.sent.where((r) => r.path == '/payments'), isEmpty);
    await cubit.close();
  });

  group('screen at 360 dp', () {
    setUp(() {
      final client = clientWith(
        FakeAdapter((o) => FakeReply(200, [unpaidJson()])),
      );
      getIt
        ..registerSingleton<PaymentsRepository>(PaymentsRepository(client))
        ..registerSingleton<ClientsRepository>(ClientsRepository(client));
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('cheque versement with an allocation in $locale', (
        tester,
      ) async {
        await pumpScreen(
          tester,
          VersementScreen(
            client: BasketClient(
              id: 'c1',
              code: 'CL-001',
              name: 'Supérette El Baraka',
              balance: d('45230.50'),
            ),
          ),
          locale: locale,
        );
        await tester.tap(find.text(locale == 'fr' ? 'Chèque' : 'صك'));
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsNWidgets(4));
        expectNoOverflow(tester);
      });
    }
  });
}

Future<String?> _never(ApiError _) async => null;
