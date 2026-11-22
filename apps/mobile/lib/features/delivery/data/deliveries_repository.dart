import '../../../core/network/api_result.dart';
import '../../orders/data/models/order.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../today/data/models/today.dart';
import '../../today/data/repo/today_repository.dart';
import '../logic/delivery_groups.dart';

/// The livreur's list: `GET /orders?status=CONFIRMED` (the API keeps a
/// livreur to the orders put on him or on the truck he drives) and, with
/// TOURNEES, today's stops from `GET /me/today` for the route order.
class DeliveriesRepository {
  DeliveriesRepository(this._orders, this._today);

  final OrdersRepository _orders;
  final TodayRepository _today;

  /// Pages read at most (30 orders each): a day's deliveries fit easily.
  static const maxPages = 10;

  Future<ApiResult<DeliveriesBoard>> board({required bool withRoute}) async {
    final orders = <OrderSummary>[];
    String? cursor;
    for (var page = 0; page < maxPages; page++) {
      final result = await _orders.list(status: 'CONFIRMED', cursor: cursor);
      switch (result) {
        case Failure(:final error):
          return Failure(error);
        case Success(:final data):
          orders.addAll(data.items);
          cursor = data.hasMore ? data.nextCursor : null;
      }
      if (cursor == null) break;
    }
    var stops = const <TodayStop>[];
    if (withRoute && orders.isNotEmpty) {
      // Without the tournée the list still works, grouped by client.
      final today = await _today.today();
      if (today case Success(:final data)) stops = data.stops;
    }
    return Success(groupDeliveries(orders, stops));
  }
}
