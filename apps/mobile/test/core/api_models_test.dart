import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/models/paginated.dart';
import 'package:orvynt_starter/features/catalog/data/models/home_feed.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/data/models/store.dart';
import 'package:orvynt_starter/features/order/data/models/order.dart';

/// Fixtures are real responses captured from the backend test harness
/// (in-memory Mongo + demo seed), so these tests break when the API shape
/// drifts from the models.
Map<String, dynamic> _body(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as Map<String, dynamic>;

Map<String, dynamic> _data(String name) =>
    _body(name)['data'] as Map<String, dynamic>;

void main() {
  test('home feed parses categories, deals and stores', () {
    final feed = HomeFeed.fromJson(_data('home'));
    expect(feed.categories, isNotEmpty);
    expect(feed.stores, isNotEmpty);
  });

  test('product list flattens the populated store', () {
    final page = Paginated.fromJson(_body('products'), Product.fromJson);
    final product = page.items.first;
    expect(page.total, greaterThan(0));
    expect(product.storeId, isNotEmpty);
    expect(product.store?.name, isNotEmpty);
    expect(product.finalPrice, lessThanOrEqualTo(product.price));
  });

  test('product detail carries category and store summaries', () {
    final product = Product.fromJson(_data('product'));
    expect(product.category?.id, product.categoryId);
    expect(product.store?.id, product.storeId);
  });

  test('store detail includes its product preview and hours', () {
    final store = Store.fromJson(_data('store'));
    expect(store.products, isNotEmpty);
    expect(store.openingHours, isNotEmpty);
  });

  test('login returns tokens and a client user', () {
    final session = AuthSession.fromJson(_data('login'));
    expect(session.accessToken, isNotEmpty);
    expect(session.user.role, 'client');
  });

  test('order detail resolves item names and statuses', () {
    final order = Order.fromJson(_data('order_detail'));
    expect(order.status, OrderStatus.pending);
    expect(order.items.first.name, isNotEmpty);
    expect(order.items.first.storeName, isNotEmpty);
    expect(order.statusHistory, isNotEmpty);
  });

  test('order list maps snake_case statuses', () {
    final page = Paginated.fromJson(_body('orders_mine'), Order.fromJson);
    expect(
      page.items.map((o) => o.status),
      containsAll([OrderStatus.delivered, OrderStatus.outForDelivery]),
    );
  });
}
