import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/geo/geo_fix.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/core/network/money_action.dart';
import 'package:orvynt_starter/features/delivery/logic/delivery_cubit.dart';
import 'package:orvynt_starter/features/delivery/logic/delivery_form.dart';
import 'package:orvynt_starter/features/delivery/ui/order_delivery_screen.dart';
import 'package:orvynt_starter/features/orders/data/models/order.dart';
import 'package:orvynt_starter/features/orders/data/repo/orders_repository.dart';
import 'package:orvynt_starter/features/sales/data/repo/sales_repository.dart';
import 'package:orvynt_starter/features/sales/logic/basket.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> line({
  required String id,
  required int position,
  String productId = 'p1',
  String designation = 'Eau minérale 1,5 L',
  String unitCode = 'CRT',
  String factor = '24.000',
  required String qty,
  String price = '960.00',
  String discount = '0.00',
  String tva = '19.00',
  bool isFree = false,
  int? freeOf,
  String? available = '100.000',
  String? promotion,
}) => {
  'id': id,
  'position': position,
  'productId': productId,
  'reference': 'REF-$id',
  'designation': designation,
  'unitId': 'u-$unitCode',
  'unitCode': unitCode,
  'factorToBase': factor,
  'qty': qty,
  'qtyBase': qty,
  'unitPriceHt': isFree ? '0.00' : price,
  'discountPct': discount,
  'tvaRate': tva,
  'lineHt': '0.00',
  'qtyDelivered': null,
  'qtyNotDelivered': null,
  'isFree': isFree,
  'promotion': promotion == null ? null : {'id': 'pr1', 'name': promotion},
  'freeOfPosition': freeOf,
  'availableBase': available,
};

/// 10 CRT of water with 2 CRT free (promotion), 6 PCE of juice at 42,00
/// with a 5 % remise and TVA 9 %; the truck holds 4 CRT of water.
Map<String, dynamic> deliveryOrderJson({
  String status = 'CONFIRMED',
  bool assujetti = true,
}) => {
  ...orderJson(status: status),
  'assujettiTva': assujetti,
  'client': {
    'id': 'c1',
    'code': 'CL-001',
    'name': 'Alimentation Générale Benali et Fils Grossiste Détail',
    'phone': '0550 12 34 56',
  },
  'deliveryVehicle': {
    'id': 'v2',
    'code': 'CAM-02',
    'name': 'Isuzu NPR',
    'wilayaCode': 16,
  },
  'lines': [
    line(
      id: 'ol1',
      position: 1,
      qty: '10.000',
      available: '96.000',
      promotion: 'Ramadan 10+2',
    ),
    line(
      id: 'ol2',
      position: 2,
      qty: '2.000',
      isFree: true,
      freeOf: 1,
      available: '96.000',
    ),
    line(
      id: 'ol3',
      position: 3,
      productId: 'p2',
      designation: 'Jus d\'orange 1 L pack familial',
      unitCode: 'PCE',
      factor: '1.000',
      qty: '6.000',
      price: '42.00',
      discount: '5.00',
      tva: '9.00',
      available: '50.000',
    ),
  ],
};

Order order({String status = 'CONFIRMED', bool assujetti = true}) =>
    Order.fromJson(deliveryOrderJson(status: status, assujetti: assujetti));

Map<String, dynamic> deliverResultJson({String status = 'FAR'}) => {
  'order': deliveryOrderJson(status: 'DELIVERED'),
  'sale': {'id': 'sale-1', 'number': 'BL-2026-000130', 'totalTtc': '2284.80'},
  'warnings': <Object>[],
  'change': '0.00',
  'geoCheck': {
    'id': 'g1',
    'status': status,
    'distanceM': 900,
    'flags': <Object>[],
    'offerSaveClientLocation': false,
  },
};

ApiClient apiWith(FakeAdapter a) => ApiClient(
  dio: Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = a,
);

final fix = GeoFix(
  lat: 36.75,
  lng: 3.05,
  accuracyM: 12,
  capturedAt: DateTime.utc(2026, 11, 22, 9),
);

void main() {
  group('DeliveryForm', () {
    test('starts at the ordered quantities, free lines aside', () {
      final f = DeliveryForm(order());
      expect(f.paidLines.map((l) => l.id), ['ol1', 'ol3']);
      expect(f.qtyOf(f.paidLines.first), Decimal.fromInt(10));
      expect(f.isPartial, isFalse);
      expect(f.anyDelivered, isTrue);
      expect(f.deliveredLineCount, 2);
      final free = f.freeLinesOf(f.paidLines.first).single;
      expect(f.freeQtyOf(free), Decimal.fromInt(2));
    });

    test('a quantity stays between 0 and the ordered one', () {
      final f = DeliveryForm(order());
      final water = f.paidLines.first;
      expect(f.withQty(water, Decimal.fromInt(14)).qtyOf(water), water.qty);
      expect(f.withQty(water, Decimal.fromInt(-1)).qtyOf(water), Decimal.zero);
      expect(f.increment(water).qtyOf(water), water.qty);
      final partial = f.decrement(water);
      expect(partial.qtyOf(water), Decimal.fromInt(9));
      expect(partial.isPartial, isTrue);
      expect(partial.all().isPartial, isFalse);
    });

    test('free units follow their paid line in proportion, half up', () {
      final f = DeliveryForm(order());
      final water = f.paidLines.first;
      final free = f.freeLinesOf(water).single;
      // 7 of 10 → 1,4 free → 1 whole carton; 8 of 10 → 1,6 → 2.
      expect(f.withQty(water, Decimal.fromInt(7)).freeQtyOf(free), Decimal.one);
      expect(
        f.withQty(water, Decimal.fromInt(8)).freeQtyOf(free),
        Decimal.fromInt(2),
      );
      expect(f.withQty(water, Decimal.zero).freeQtyOf(free), Decimal.zero);
    });

    test('totals follow computeTotals: line HT rounded, TVA per rate', () {
      final f = DeliveryForm(order());
      // Water 10 × 960 = 9 600,00 (TVA 19 % = 1 824,00);
      // juice 6 × 42 × 0,95 = 239,40 (TVA 9 % = 21,546 → 21,55).
      expect(f.totals.totalHt, Decimal.parse('9839.40'));
      expect(f.totals.totalTva, Decimal.parse('1845.55'));
      expect(f.totals.totalTtc, Decimal.parse('11684.95'));
      final noWater = f.withQty(f.paidLines.first, Decimal.zero);
      expect(noWater.totals.totalTtc, Decimal.parse('260.95'));
      final notAssujetti = DeliveryForm(order(assujetti: false));
      expect(notAssujetti.totals.totalTva, Decimal.zero);
      expect(notAssujetti.totals.totalTtc, Decimal.parse('9839.40'));
    });

    test('nothing delivered is caught before sending', () {
      var f = DeliveryForm(order());
      for (final l in f.paidLines) {
        f = f.withQty(l, Decimal.zero);
      }
      expect(f.anyDelivered, isFalse);
      expect(f.deliveredLineCount, 0);
    });

    test('the truck stock is shown in the line unit; above it is flagged', () {
      final f = DeliveryForm(order());
      final water = f.paidLines.first;
      // 96 pièces = 4 cartons; 10 ordered.
      expect(f.stockInUnit(water), Decimal.fromInt(4));
      expect(f.overStock(water), isTrue);
      expect(f.withQty(water, Decimal.fromInt(4)).overStock(water), isFalse);
      expect(f.overStock(f.paidLines.last), isFalse);
    });

    test('the body follows deliverOrderSchema', () {
      final f = DeliveryForm(
        order(),
      ).withQty(order().lines.first, Decimal.zero);
      final body = f.body(
        paid: Decimal.parse('100.5'),
        mode: PaymentModeValue.cheque,
        packagingReturned: const {'pk1': 3, 'pk2': 0},
        geo: geoInputJson(fix),
      );
      expect(body['lines'], [
        {'orderLineId': 'ol1', 'qty': '0.000'},
        {'orderLineId': 'ol3', 'qty': '6.000'},
      ]);
      expect(body['paidAmount'], '100.50');
      expect(body['paymentMode'], 'CHEQUE');
      expect(body['packagingReturned'], [
        {'packagingTypeId': 'pk1', 'qty': 3},
      ]);
      expect((body['geo'] as Map)['accuracyM'], 12);
    });
  });

  group('DeliveryCubit', () {
    late List<FakeReply> deliverReplies;
    late FakeAdapter api;
    late DeliveryCubit cubit;
    var saleFails = false;

    setUp(() {
      saleFails = false;
      deliverReplies = [];
      api = FakeAdapter((o) {
        if (o.path == '/orders/o1') return FakeReply(200, deliveryOrderJson());
        if (o.path == '/orders/o1/deliver') return deliverReplies.removeAt(0);
        if (o.path == '/sales/sale-1') {
          return saleFails
              ? const FakeReply(404, {'code': 'NOT_FOUND', 'message': ''})
              : FakeReply(200, saleResultJson()['sale']);
        }
        return const FakeReply(404, {'code': 'NOT_FOUND', 'message': ''});
      });
      final client = apiWith(api);
      cubit = DeliveryCubit(
        OrdersRepository(client),
        SalesRepository(client),
        orderId: 'o1',
      );
    });
    tearDown(() => cubit.close());

    List<SentRequest> delivers() =>
        api.sent.where((r) => r.path == '/orders/o1/deliver').toList();

    test('a retry after a timeout reuses the key: one BL', () async {
      await cubit.load();
      deliverReplies = [
        const FakeReply.fail(DioExceptionType.receiveTimeout),
        FakeReply(200, deliverResultJson()),
      ];
      const runner = MoneyActionRunner(askGeoNote: _noNote);
      expect(await cubit.submit(geo: fix, runner: runner), isNull);
      expect(cubit.state.error!.isOffline, isTrue);
      final key = cubit.key.value;
      final done = await cubit.submit(geo: fix, runner: runner);
      expect(done!.saleNumber, 'BL-2026-000130');
      final sent = delivers();
      expect(sent, hasLength(2));
      expect(sent[0].headers[IdempotencyKey.header], key);
      expect(sent[1].headers[IdempotencyKey.header], key);
      // Renewed after the success; the BL is the server's.
      expect(cubit.key.value, isNot(key));
      expect(cubit.state.bl!.sale.number, 'BL-2026-000130');
      expect(cubit.state.bl!.geoStatus, 'FAR');
      expect(cubit.state.canSubmit, isFalse);
    });

    test('GEO_NOTE_REQUIRED: the note goes again with the same key', () async {
      await cubit.load();
      deliverReplies = [
        const FakeReply(409, {
          'code': 'GEO_NOTE_REQUIRED',
          'message': 'A note is required',
          'details': {'status': 'FAR', 'distanceM': 900},
        }),
        FakeReply(200, deliverResultJson()),
      ];
      final runner = MoneyActionRunner(
        askGeoNote: (_) async => 'Livré à son dépôt',
      );
      await cubit.submit(geo: fix, runner: runner);
      final sent = delivers();
      expect(sent, hasLength(2));
      expect(
        sent[1].headers[IdempotencyKey.header],
        sent[0].headers[IdempotencyKey.header],
      );
      final first = (sent[0].body as Map)['geo'] as Map;
      final second = (sent[1].body as Map)['geo'] as Map;
      expect(first.containsKey('note'), isFalse);
      expect(second['note'], 'Livré à son dépôt');
      expect(second['lat'], first['lat']);
      expect(cubit.state.delivered, isNotNull);
    });

    test('a refusal stays on screen and nothing is delivered', () async {
      await cubit.load();
      deliverReplies = [
        const FakeReply(409, {
          'code': 'CREDIT_LIMIT_EXCEEDED',
          'message': 'Over the limit',
          'details': {
            'balance': '45000.00',
            'limit': '50000.00',
            'projected': '56684.95',
          },
        }),
      ];
      const runner = MoneyActionRunner(askGeoNote: _noNote);
      await cubit.submit(geo: null, runner: runner);
      expect(cubit.state.error!.code, 'CREDIT_LIMIT_EXCEEDED');
      expect(cubit.state.delivered, isNull);
      expect(cubit.state.submitting, isFalse);
      expect(cubit.state.canSubmit, isTrue);
      expect((delivers().single.body as Map)['geo'], {'isMocked': false});
    });

    test('when the BL cannot be read back, the delivery still shows', () async {
      saleFails = true;
      await cubit.load();
      deliverReplies = [FakeReply(200, deliverResultJson(status: 'OK'))];
      const runner = MoneyActionRunner(askGeoNote: _noNote);
      await cubit.submit(geo: fix, runner: runner);
      expect(cubit.state.delivered!.saleId, 'sale-1');
      expect(cubit.state.bl, isNull);
    });

    test(
      'nothing delivered or an order no longer confirmed is not sent',
      () async {
        await cubit.load();
        for (final l in cubit.state.form!.paidLines) {
          cubit.deliverNone(l);
        }
        expect(cubit.state.canSubmit, isFalse);
        const runner = MoneyActionRunner(askGeoNote: _noNote);
        expect(await cubit.submit(geo: null, runner: runner), isNull);
        expect(delivers(), isEmpty);
      },
    );

    test('pay all takes the previewed TTC', () async {
      await cubit.load();
      cubit.payAll();
      expect(cubit.state.paid, Decimal.parse('11684.95'));
      expect(cubit.state.credit, Decimal.zero);
      cubit.setPaid(null);
      expect(cubit.state.credit, Decimal.parse('11684.95'));
    });
  });

  group('screen at 360 dp', () {
    var status = 'CONFIRMED';
    setUp(() {
      status = 'CONFIRMED';
      final client = apiWith(
        FakeAdapter((o) {
          if (o.path == '/orders/o1') {
            return FakeReply(200, deliveryOrderJson(status: status));
          }
          if (o.path == '/packaging-types') {
            return const FakeReply(200, [
              {
                'id': 'pk1',
                'name': 'Casier',
                'depositValue': null,
                'productCount': 3,
              },
            ]);
          }
          return const FakeReply(404, {'code': 'NOT_FOUND', 'message': ''});
        }),
      );
      getIt
        ..registerSingleton<OrdersRepository>(OrdersRepository(client))
        ..registerSingleton<SalesRepository>(SalesRepository(client));
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('delivery form in $locale', (tester) async {
        await pumpScreen(
          tester,
          const OrderDeliveryScreen(orderId: 'o1'),
          locale: locale,
          user: livreur(),
        );
        expect(find.byType(DeliveryLineTile), findsWidgets);
        expect(find.byType(OrderHeaderCard), findsOneWidget);
        // Truck stock above → warning; prices are read only.
        expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
        expect(find.byIcon(Icons.percent), findsNothing);
        await tester.scrollUntilVisible(
          find.text('Casier'),
          300,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text('Casier'), findsOneWidget);
        expectNoOverflow(tester);
      });
    }

    testWidgets('a delivered order cannot be delivered again', (tester) async {
      status = 'DELIVERED';
      await pumpScreen(
        tester,
        const OrderDeliveryScreen(orderId: 'o1'),
        locale: 'fr',
        user: livreur(),
      );
      expect(find.byType(DeliveryLineTile), findsNothing);
      expect(find.textContaining('Livrée'), findsWidgets);
      expect(find.text('Valider la livraison'), findsNothing);
      expectNoOverflow(tester);
    });
  });
}

Future<String?> _noNote(Object _) async => null;
