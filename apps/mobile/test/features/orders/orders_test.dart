import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/orders/data/models/order.dart';
import 'package:orvynt_starter/features/orders/data/repo/orders_repository.dart';
import 'package:orvynt_starter/features/orders/logic/order_submitter.dart';
import 'package:orvynt_starter/features/sales/data/repo/sales_repository.dart';
import 'package:orvynt_starter/features/sales/logic/basket.dart';
import 'package:orvynt_starter/features/sales/logic/sale_basket_cubit.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';

ApiClient clientWith(FakeAdapter a) => ApiClient(
  dio: Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = a,
);

void main() {
  test('an order decodes with Decimal totals', () {
    final o = Order.fromJson(orderJson());
    expect(o.number, 'BC-2026-000044');
    expect(o.totalTtc, Decimal.parse('2284.8'));
    expect(o.lines.single.qty, Decimal.fromInt(2));
    expect(
      Order.fromJson(orderJson(status: 'DRAFT', number: null)).isDraft,
      isTrue,
    );
  });

  test('the order body follows createOrderSchema', () {
    final body = orderBody(
      clientId: 'c1',
      lines: [
        {'productId': 'p1', 'unitId': 'u-crt', 'qty': '2.000'},
      ],
      requestedDate: '2026-11-23',
    );
    expect(body, {
      'clientId': 'c1',
      'warehouseId': null,
      'requestedDate': '2026-11-23',
      'note': '',
      'lines': [
        {'productId': 'p1', 'unitId': 'u-crt', 'qty': '2.000'},
      ],
    });
  });

  test('a confirm that timed out is retried alone with its own key', () async {
    var confirms = 0;
    final api = FakeAdapter((o) {
      if (o.path == '/orders') {
        return FakeReply(201, orderJson(status: 'DRAFT', number: null));
      }
      confirms++;
      return confirms == 1
          ? const FakeReply.fail(DioExceptionType.connectionError)
          : FakeReply(200, orderJson());
    });
    final submitter = OrderSubmitter(OrdersRepository(clientWith(api)));
    final body = orderBody(clientId: 'c1', lines: const []);

    final first = await submitter.submit(body);
    expect(first, isA<Object>());
    expect(submitter.draft!.isDraft, isTrue);
    await submitter.submit(body);

    final creates = api.sent.where((r) => r.path == '/orders').toList();
    final confirmCalls = api.sent
        .where((r) => r.path == '/orders/o1/confirm')
        .toList();
    expect(creates, hasLength(1));
    expect(confirmCalls, hasLength(2));
    final ck = confirmCalls[0].headers[IdempotencyKey.header];
    expect(confirmCalls[1].headers[IdempotencyKey.header], ck);
    expect(creates[0].headers[IdempotencyKey.header], isNot(ck));
  });

  test('the basket is locked once a draft order exists', () async {
    final api = FakeAdapter((o) {
      if (o.path == '/orders') {
        return FakeReply(201, orderJson(status: 'DRAFT', number: null));
      }
      if (o.path.endsWith('/confirm')) {
        return const FakeReply(409, {'code': 'CONFLICT', 'message': 'busy'});
      }
      return const FakeReply(200, {
        'lines': <Object>[],
        'totalHt': '0',
        'totalTva': '0',
        'totalTtc': '0',
      });
    });
    final client = clientWith(api);
    final cubit = SaleBasketCubit(
      SalesRepository(client),
      orders: OrdersRepository(client),
      client: const BasketClient(id: 'c1', code: 'CL-001', name: 'Supérette'),
      debounce: const Duration(hours: 1),
    );
    final product = Product.fromJson(productJson());
    cubit.add(product, product.unitById('u-crt')!, Decimal.fromInt(2));
    final order = await cubit.submitOrder(requestedDate: null);
    expect(order, isNull);
    expect(cubit.state.error!.code, 'CONFLICT');
    expect(cubit.state.orderDraft, isNotNull);
    cubit.add(product, product.unitById('u-pce')!, Decimal.one);
    expect(cubit.state.lines, hasLength(1));
    await cubit.close();
  });
}
