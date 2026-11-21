import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/service/api_result.dart';
import '../models/create_order_request.dart';
import '../models/order.dart';

/// Client orders: `POST /orders`, `/orders/mine[/:id[/cancel]]`.
///
/// Replaces the legacy `order_repository.dart`, which stays only until the
/// old order screens are rebuilt on this one.
class OrderRepository {
  OrderRepository(this._client);

  final ApiClient _client;

  static Order _order(Map<String, dynamic> body) =>
      Order.fromJson(body['data'] as Map<String, dynamic>);

  Future<ApiResult<Order>> createOrder(CreateOrderRequest request) =>
      _client.post('/orders', data: request.toJson(), fromJson: _order);

  /// List rows omit `items` and `statusHistory`; fetch [getMyOrder] for those.
  Future<ApiResult<Paginated<Order>>> getMyOrders({
    int page = 1,
    int limit = 20,
    OrderStatus? status,
  }) => _client.get(
    '/orders/mine',
    query: {
      'page': page,
      'limit': limit,
      'sort': '-createdAt',
      if (status != null) 'status': _statusValue(status),
    },
    fromJson: (body) => Paginated.fromJson(body, Order.fromJson),
  );

  Future<ApiResult<Order>> getMyOrder(String id) =>
      _client.get('/orders/mine/$id', fromJson: _order);

  /// Only `pending` orders can be cancelled (else `ORDER_NOT_CANCELABLE`).
  Future<ApiResult<Order>> cancelOrder(
    String id, {
    String reason = 'customer_request',
    String? note,
  }) => _client.post(
    '/orders/mine/$id/cancel',
    data: {'reason': reason, if (note != null && note.isNotEmpty) 'note': note},
    fromJson: _order,
  );

  static String _statusValue(OrderStatus status) => switch (status) {
    OrderStatus.outForDelivery => 'out_for_delivery',
    _ => status.name,
  };
}
