import 'dart:convert';
import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/service/api_result.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/session/session_state.dart';
import 'package:orvynt_starter/features/account/data/models/address.dart';
import 'package:orvynt_starter/features/cart/logic/cart_cubit.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/checkout/logic/checkout_cubit.dart';
import 'package:orvynt_starter/features/order/data/models/create_order_request.dart';
import 'package:orvynt_starter/features/order/data/models/order.dart';
import 'package:orvynt_starter/features/order/data/repo/orders_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Records the `POST /orders` bodies instead of sending them.
class _FakeOrders implements OrderRepository {
  final sent = <Map<String, dynamic>>[];

  @override
  Future<ApiResult<Order>> createOrder(CreateOrderRequest request) async {
    sent.add(request.toJson());
    // The backend answers an order without address with `address: ''`.
    final body =
        jsonDecode(File('test/fixtures/order_detail.json').readAsStringSync())
            as Map<String, dynamic>;
    final data = body['data'] as Map<String, dynamic>;
    (data['customer'] as Map<String, dynamic>).remove('address');
    return ApiResult.success(Order.fromJson(data));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A signed-in session whose address book the test can change.
class _FakeSession extends Cubit<SessionState> implements SessionCubit {
  _FakeSession(AuthUser user) : super(SessionState.authenticated(user));

  @override
  AuthUser? get user => state.user;

  void setUser(AuthUser user) => emit(SessionState.authenticated(user));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _home = Address(id: 'a1', fullAddress: 'Rue 1, Alger', isDefault: true);
const _work = Address(id: 'a2', label: 'Work', fullAddress: 'Rue 2, Alger');

AuthUser _user([List<Address> addresses = const []]) => AuthUser(
  id: 'u1',
  name: 'Amine',
  phone: '+213555000201',
  addresses: addresses,
);

const _product = Product(
  id: 'p1',
  storeId: 's1',
  categoryId: 'c1',
  name: 'Item',
  price: 100,
  finalPrice: 100,
);

void main() {
  // CartCubit.add triggers haptic feedback, which needs the binding.
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('submits without any address field when none is saved', () async {
    final orders = _FakeOrders();
    final cart = CartCubit()..add(_product, qty: 2);
    final cubit = CheckoutCubit(orders, cart, _FakeSession(_user()));

    expect(cubit.state.addressId, isNull);
    await cubit.submit(note: ' call me ');

    expect(orders.sent, [
      {
        'items': [
          {'productId': 'p1', 'qty': 2},
        ],
        'customer': {
          'name': 'Amine',
          'phone': '+213555000201',
          'note': 'call me',
        },
      },
    ]);
    expect(cubit.state.placed, isNotNull);
    expect(cubit.state.placed!.customer.address, '');
    expect(cart.state.isEmpty, isTrue);
  });

  test('"address by phone" drops the saved address from the request', () async {
    final orders = _FakeOrders();
    final cart = CartCubit()..add(_product);
    final cubit = CheckoutCubit(orders, cart, _FakeSession(_user([_home])));
    expect(cubit.state.addressId, 'a1');

    cubit.selectNoAddress();
    await cubit.submit();

    final body = orders.sent.single;
    expect(body.containsKey('addressId'), isFalse);
    expect(body['customer'], {'name': 'Amine', 'phone': '+213555000201'});
  });

  test('still sends the saved address when one is picked', () async {
    final orders = _FakeOrders();
    final cart = CartCubit()..add(_product);
    final cubit = CheckoutCubit(orders, cart, _FakeSession(_user([_home])));

    await cubit.submit();

    expect(orders.sent.single['addressId'], 'a1');
  });

  test('keeps "no address" selected, selects a newly added address', () {
    final session = _FakeSession(_user([_home]));
    final cubit = CheckoutCubit(_FakeOrders(), CartCubit(), session);

    cubit.selectNoAddress();
    cubit.syncAddresses();
    expect(cubit.state.addressId, isNull);

    session.setUser(_user([_home, _work]));
    cubit.syncAddresses();
    expect(cubit.state.addressId, 'a2');

    // The picked address was deleted: back to the default one.
    session.setUser(_user([_home]));
    cubit.syncAddresses();
    expect(cubit.state.addressId, 'a1');
  });
}
