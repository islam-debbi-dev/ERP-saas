import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/geo/geo_fix.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/core/network/money_action.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/ui/product_picker_screen.dart';
import 'package:orvynt_starter/features/sales/data/repo/sales_repository.dart';
import 'package:orvynt_starter/features/sales/logic/basket.dart';
import 'package:orvynt_starter/features/sales/logic/sale_basket_cubit.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';

Decimal d(String v) => Decimal.parse(v);

final product = Product.fromJson(productJson());
final carton = product.unitById('u-crt')!;
final piece = product.unitById('u-pce')!;
const client = BasketClient(
  id: 'c1',
  code: 'CL-001',
  name: 'Supérette El Baraka',
);
final fix = GeoFix(
  lat: 36.7,
  lng: 3.1,
  accuracyM: 8,
  capturedAt: DateTime.utc(2026, 11, 22, 9, 30),
);

/// Answers with a delay per request, so a slow first preview can land after
/// a fast second one.
class DelayedAdapter implements HttpClientAdapter {
  DelayedAdapter(this.handler);
  final (Duration, FakeReply) Function(RequestOptions o, int n) handler;
  final List<SentRequest> sent = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? s,
    Future<void>? c,
  ) async {
    sent.add(SentRequest(o.method, o.path, Map.of(o.headers), o.data));
    final (delay, reply) = handler(o, sent.length);
    await Future<void>.delayed(delay);
    if (reply.failure != null) {
      throw DioException(requestOptions: o, type: reply.failure!);
    }
    return ResponseBody.fromString(
      jsonEncode(reply.body),
      reply.status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> previewOf(String qty, String lineHt, String ttc) => {
  'lines': [pricedLine(index: 0, qty: qty, lineHt: lineHt)],
  'totalHt': lineHt,
  'totalTva': '0.00',
  'totalTtc': ttc,
};

SalesRepository repoWith(HttpClientAdapter adapter) => SalesRepository(
  ApiClient(
    dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
      ..httpClientAdapter = adapter,
  ),
);

const noNotes = MoneyActionRunner(askGeoNote: _never);
Future<String?> _never(ApiError _) async => null;

void main() {
  group('basket lines', () {
    late SaleBasketCubit cubit;
    setUp(() {
      final api = FakeAdapter(
        (_) => FakeReply(200, previewOf('1.000', '960.00', '1142.40')),
      );
      cubit = SaleBasketCubit(
        repoWith(api),
        client: client,
        debounce: Duration.zero,
      );
    });
    tearDown(() => cubit.close());

    test('the same product and unit adds up; another unit is a new line', () {
      cubit.add(product, carton, d('2'));
      cubit.add(product, carton, d('1'));
      cubit.add(product, piece, d('5'));
      expect(cubit.state.lines, hasLength(2));
      expect(cubit.state.lines[0].qty, d('3'));
      expect(cubit.state.lines[0].qtyBase, d('72'));
      expect(cubit.state.lines[1].qtyBase, d('5'));
    });

    test('decrement to zero removes the line; unit change keeps the qty', () {
      cubit.add(product, carton, d('1'));
      cubit.setUnit(0, piece);
      expect(cubit.state.lines.single.unit.unitId, 'u-pce');
      expect(cubit.state.lines.single.qty, d('1'));
      cubit.decrement(0);
      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.preview, isNull);
    });

    test('a line goes to the API as strings, never doubles', () {
      cubit.add(product, carton, d('2.5'));
      final json = cubit.state.lines.single.toJson();
      expect(json, {'productId': 'p1', 'unitId': 'u-crt', 'qty': '2.500'});
    });

    test('the preview gives the TTC; paid and credit follow it', () async {
      cubit.add(product, carton, d('1'));
      await cubit.priceNow();
      expect(cubit.state.estimatedTtc, d('1142.40'));
      expect(cubit.state.estimatedCredit, d('1142.40'));
      cubit.setPaid(d('1000'));
      expect(cubit.state.estimatedCredit, d('142.40'));
      cubit.payAll();
      expect(cubit.state.paid, d('1142.40'));
      expect(cubit.state.estimatedCredit, Decimal.zero);
    });
  });

  test('an older, slower preview never replaces the latest one', () async {
    final adapter = DelayedAdapter(
      (o, n) => n == 1
          ? (
              const Duration(milliseconds: 120),
              FakeReply(200, previewOf('1.000', '960.00', '1142.40')),
            )
          : (
              const Duration(milliseconds: 10),
              FakeReply(200, previewOf('2.000', '1920.00', '2284.80')),
            ),
    );
    final cubit = SaleBasketCubit(repoWith(adapter), debounce: Duration.zero);
    cubit.add(product, carton, d('1'));
    final first = cubit.priceNow();
    cubit.add(product, carton, d('1'));
    final second = cubit.priceNow();
    await Future.wait([first, second]);
    expect(cubit.state.estimatedTtc, d('2284.80'));
    expect(cubit.state.pricing, isFalse);
    await cubit.close();
  });

  group('discount policy', () {
    test('without PRICE_OVERRIDE no discount is kept', () {
      const p = DiscountPolicy.none();
      expect(p.clamp(d('5')), isNull);
    });

    test('capped at maxDiscountPct without DISCOUNT_ABOVE_X', () {
      final p = DiscountPolicy(
        canDiscount: true,
        aboveCeiling: false,
        ceiling: d('5'),
      );
      expect(p.clamp(d('3')), d('3'));
      expect(p.clamp(d('12')), d('5'));
      expect(p.clamp(d('-1')), Decimal.zero);
      final above = DiscountPolicy(
        canDiscount: true,
        aboveCeiling: true,
        ceiling: d('5'),
      );
      expect(above.clamp(d('12')), d('12'));
    });

    test('the cubit applies the cap to a typed remise', () async {
      final cubit = SaleBasketCubit(
        repoWith(
          FakeAdapter(
            (_) => FakeReply(200, previewOf('1.000', '960.00', '1142.40')),
          ),
        ),
        debounce: Duration.zero,
        policy: DiscountPolicy(
          canDiscount: true,
          aboveCeiling: false,
          ceiling: d('5'),
        ),
      );
      cubit.add(product, carton, d('1'));
      cubit.setDiscount(0, d('20'));
      expect(cubit.state.lines.single.discountPct, d('5'));
      expect(cubit.state.lines.single.toJson()['discountPct'], '5.00');
      await cubit.close();
    });
  });

  test('the quick sale body follows quickSaleSchema', () {
    final cubit = SaleBasketCubit(
      repoWith(FakeAdapter((_) => const FakeReply(200, {}))),
      client: client,
      debounce: const Duration(hours: 1),
      clock: () =>
          DateTime.utc(2026, 11, 22, 23, 30), // already the 23rd in Algiers
    );
    cubit.add(product, carton, d('2'));
    cubit.setPaid(d('1000.5'));
    cubit.setMode(PaymentModeValue.cheque);
    cubit.setPackaging('pk1', 3);
    final body = cubit.body(truckId: 'v1', geo: fix);
    expect(body['type'], 'BL');
    expect(body['clientId'], 'c1');
    expect(body['documentDate'], '2026-11-23');
    expect(body['warehouseId'], 'v1');
    expect(body['paidAmount'], '1000.50');
    expect(body['paymentMode'], 'CHEQUE');
    expect(body['packagingReturned'], [
      {'packagingTypeId': 'pk1', 'qty': 3},
    ]);
    expect((body['geo'] as Map)['accuracyM'], 8);
    expect(body['lines'], [
      {'productId': 'p1', 'unitId': 'u-crt', 'qty': '2.000'},
    ]);
    cubit.close();
  });

  group('idempotency', () {
    test(
      'a retry after a timeout sends the same key; the next sale a new one',
      () async {
        var calls = 0;
        final api = FakeAdapter((o) {
          if (o.path == '/pricing/preview') {
            return FakeReply(200, previewOf('2.000', '1920.00', '2284.80'));
          }
          calls++;
          return calls == 1
              ? const FakeReply.fail(DioExceptionType.receiveTimeout)
              : FakeReply(201, saleResultJson());
        });
        final cubit = SaleBasketCubit(
          repoWith(api),
          client: client,
          debounce: const Duration(hours: 1),
        );
        cubit.add(product, carton, d('2'));

        expect(
          await cubit.submit(truckId: 'v1', geo: fix, runner: noNotes),
          isNull,
        );
        expect(cubit.state.error!.kind, ApiErrorKind.timeout);
        final result = await cubit.submit(
          truckId: 'v1',
          geo: fix,
          runner: noNotes,
        );
        expect(result!.sale.number, 'BL-2026-000130');

        final sales = api.sent.where((r) => r.path == '/sales/quick').toList();
        expect(sales, hasLength(2));
        final k1 = sales[0].headers[IdempotencyKey.header];
        expect(k1, isNotNull);
        expect(sales[1].headers[IdempotencyKey.header], k1);

        cubit.startNew();
        expect(cubit.key.value, isNot(k1));
        expect(cubit.state.isEmpty, isTrue);
        await cubit.close();
      },
    );

    test(
      'GEO_NOTE_REQUIRED: the note is asked and sent with the same key',
      () async {
        var calls = 0;
        final api = FakeAdapter((o) {
          calls++;
          return calls == 1
              ? const FakeReply(422, {
                  'code': 'GEO_NOTE_REQUIRED',
                  'message': 'A note is required',
                  'details': {'status': 'FAR', 'distanceM': 900},
                })
              : FakeReply(201, saleResultJson());
        });
        final cubit = SaleBasketCubit(
          repoWith(api),
          client: client,
          debounce: const Duration(hours: 1),
        );
        cubit.add(product, carton, d('2'));
        ApiError? asked;
        final result = await cubit.submit(
          truckId: null,
          geo: fix,
          runner: MoneyActionRunner(
            askGeoNote: (e) async {
              asked = e;
              return 'Client déménagé au marché';
            },
          ),
        );
        expect(asked!.detail('distanceM'), 900);
        expect(result, isNotNull);
        final sales = api.sent.where((r) => r.path == '/sales/quick').toList();
        expect(sales, hasLength(2));
        expect(
          sales[1].headers[IdempotencyKey.header],
          sales[0].headers[IdempotencyKey.header],
        );
        final geo1 = (sales[0].body as Map)['geo'] as Map;
        final geo2 = (sales[1].body as Map)['geo'] as Map;
        expect(geo1.containsKey('note'), isFalse);
        expect(geo2['note'], 'Client déménagé au marché');
        expect(geo2['lat'], geo1['lat']);
        await cubit.close();
      },
    );

    test(
      'a refused note keeps the error on screen and sends nothing more',
      () async {
        final api = FakeAdapter(
          (_) => const FakeReply(422, {
            'code': 'GEO_NOTE_REQUIRED',
            'message': 'note',
          }),
        );
        final cubit = SaleBasketCubit(
          repoWith(api),
          client: client,
          debounce: const Duration(hours: 1),
        );
        cubit.add(product, carton, d('1'));
        await cubit.submit(truckId: null, geo: null, runner: noNotes);
        expect(cubit.state.error!.code, 'GEO_NOTE_REQUIRED');
        expect(api.sent, hasLength(1));
        await cubit.close();
      },
    );
  });

  test('truck stock reads as cartons + pièces', () {
    expect(stockText(product, d('53')), contains('2'));
    expect(stockText(product, d('53')), contains('CRT'));
    expect(stockText(product, d('53')), contains('PCE'));
    expect(stockText(product, d('48')), isNot(contains('PCE')));
    expect(stockText(product, d('0')), contains('PCE'));
  });
}
