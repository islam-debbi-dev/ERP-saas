import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/idempotency_key.dart';
import '../../../delivery/data/deliver_result.dart';
import '../models/order.dart';

/// Bons de commande (prévente, TOURNEES). A SELLER's orders are always his.
class OrdersRepository {
  OrdersRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<Order>> create(
    Map<String, dynamic> body,
    IdempotencyKey key,
  ) => _api.post(
    '/orders',
    data: body,
    idempotencyKey: key,
    decode: (json) => Order.fromJson(json.asMap),
  );

  Future<ApiResult<Order>> confirm(String id, IdempotencyKey key) => _api.post(
    '/orders/$id/confirm',
    idempotencyKey: key,
    decode: (json) => Order.fromJson(json.asMap),
  );

  Future<ApiResult<Order>> cancel(
    String id,
    String reason,
    IdempotencyKey key,
  ) => _api.post(
    '/orders/$id/cancel',
    data: {'reason': reason},
    idempotencyKey: key,
    decode: (json) => Order.fromJson(json.asMap),
  );

  /// `POST /orders/:id/deliver` (@Idempotent): the BL of the delivered
  /// quantities, from the truck the order was put on (`deliverOrderSchema`).
  Future<ApiResult<DeliverResult>> deliver(
    String id,
    Map<String, dynamic> body,
    IdempotencyKey key,
  ) => _api.post(
    '/orders/$id/deliver',
    data: body,
    idempotencyKey: key,
    decode: (json) => DeliverResult.fromJson(json.asMap),
  );

  /// Puts a confirmed order on a delivery truck (its driver delivers it) or
  /// on a person (`PATCH /orders/:id/livreur`, planners only).
  Future<ApiResult<Order>> assign(
    String id, {
    String? livreurId,
    String? deliveryVehicleId,
  }) => _api.patch(
    '/orders/$id/livreur',
    data: deliveryVehicleId != null
        ? {'deliveryVehicleId': deliveryVehicleId}
        : {'livreurId': livreurId},
    decode: (json) => Order.fromJson(json.asMap),
  );

  Future<ApiResult<Order>> get(String id) =>
      _api.get('/orders/$id', decode: (json) => Order.fromJson(json.asMap));

  Future<ApiResult<Paginated<OrderSummary>>> list({
    String? status,
    String? cursor,
  }) => _api.get(
    '/orders',
    query: {'status': status, 'cursor': cursor, 'limit': 30},
    decode: (json) => Paginated.fromJson(json.asMap, OrderSummary.fromJson),
  );
}
