import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../data/models/order.dart';
import '../data/repo/orders_repository.dart';

/// Records a pre-sale order: `POST /orders` then `POST /orders/:id/confirm`,
/// each with its own Idempotency-Key created when the form opened. When the
/// confirm fails (timeout, refusal) the draft is kept and the next tap only
/// confirms it again with the same key: never a second order.
class OrderSubmitter {
  OrderSubmitter(this._repo);

  final OrdersRepository _repo;
  final IdempotencyKey createKey = IdempotencyKey();
  final IdempotencyKey confirmKey = IdempotencyKey();

  /// The draft the API created; set after the first successful create.
  Order? draft;

  Future<ApiResult<Order>> submit(Map<String, dynamic> body) async {
    if (draft == null) {
      final created = await _repo.create(body, createKey);
      switch (created) {
        case Failure():
          return created;
        case Success(:final data):
          draft = data;
      }
    }
    return _repo.confirm(draft!.id, confirmKey);
  }
}

/// `createOrderSchema` from basket lines.
Map<String, dynamic> orderBody({
  required String clientId,
  required List<Map<String, dynamic>> lines,
  String? requestedDate,
  String? note,
}) => {
  'clientId': clientId,
  // Decided at delivery: the livreur's truck, else the main dépôt.
  'warehouseId': null,
  'requestedDate': requestedDate,
  'note': note ?? '',
  'lines': lines,
};
