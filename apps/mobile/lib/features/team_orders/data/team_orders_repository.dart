import '../../../core/helpers/algiers_day.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import '../../delivery/logic/delivery_groups.dart';
import '../../orders/data/models/order.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../team/data/team_models.dart';
import '../../team/data/team_repository.dart';

/// Someone an order can be put on (`DelivererDto`).
class Deliverer {
  const Deliverer({
    required this.id,
    required this.fullName,
    required this.role,
  });

  final String id;
  final String fullName;

  /// LIVREUR, or a SELLER who delivers himself.
  final String role;

  factory Deliverer.fromJson(Map<String, dynamic> json) => Deliverer(
    id: json['id'] as String,
    fullName: json['fullName'] as String,
    role: json['role'] as String,
  );
}

/// The team's confirmed orders, split into "to assign" and "assigned",
/// each grouped by client (M2's grouping, without a route order).
class TeamOrdersBoard {
  const TeamOrdersBoard({required this.toAssign, required this.assigned});

  final DeliveriesBoard toAssign;
  final DeliveriesBoard assigned;

  factory TeamOrdersBoard.of(List<OrderSummary> orders) => TeamOrdersBoard(
    toAssign: groupDeliveries(
      orders.where((o) => o.isUnassigned).toList(),
      const [],
    ),
    assigned: groupDeliveries(
      orders.where((o) => !o.isUnassigned).toList(),
      const [],
    ),
  );
}

/// Where an order can go: the trucks in the supervisor's reach (delivery
/// trucks first) and the deliverers of his team.
class AssignOptions {
  const AssignOptions({required this.trucks, required this.deliverers});

  final List<TruckOption> trucks;
  final List<Deliverer> deliverers;
}

/// The supervisor's Commandes tab.
///
/// `GET /orders` already keeps a supervisor to his team's orders.
/// `GET /orders/deliverers` lists every deliverer of the company, so the
/// phone keeps those of the team the API returns (`GET /seller-sessions`):
/// a seller of another supervisor is never offered.
class TeamOrdersRepository {
  TeamOrdersRepository(
    this._api,
    this._orders,
    this._team, {
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final ApiClient _api;
  final OrdersRepository _orders;
  final TeamRepository _team;
  final DateTime Function() _clock;

  /// Pages read at most (30 orders each), as on the livreur's list.
  static const maxPages = 10;

  Future<ApiResult<TeamOrdersBoard>> board() async {
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
    return Success(TeamOrdersBoard.of(orders));
  }

  Future<ApiResult<AssignOptions>> options() async {
    final results = await Future.wait([
      _team.trucks(),
      _api.get(
        '/orders/deliverers',
        decode: (json) => [
          for (final d in json.asList) Deliverer.fromJson(d.asMap),
        ],
      ),
      _team.day(AlgiersDay.of(_clock())),
    ]);
    for (final r in results) {
      if (r case Failure(:final error)) return Failure(error);
    }
    final trucks = [...(results[0] as Success<List<TruckOption>>).data]
      ..sort((a, b) {
        if (a.isDelivery != b.isDelivery) return a.isDelivery ? -1 : 1;
        return a.label.toLowerCase().compareTo(b.label.toLowerCase());
      });
    final team = {
      for (final d in (results[2] as Success<List<SellerDay>>).data)
        d.seller.id,
    };
    final deliverers = (results[1] as Success<List<Deliverer>>).data
        .where((d) => team.contains(d.id))
        .toList();
    return Success(AssignOptions(trucks: trucks, deliverers: deliverers));
  }

  Future<ApiResult<Order>> assignToTruck(String orderId, String truckId) =>
      _orders.assign(orderId, deliveryVehicleId: truckId);

  Future<ApiResult<Order>> assignToPerson(String orderId, String userId) =>
      _orders.assign(orderId, livreurId: userId);
}
