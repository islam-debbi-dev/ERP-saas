import '../../orders/data/models/order.dart';
import '../../today/data/models/today.dart';

/// The confirmed orders of one client on the livreur's list.
class DeliveryGroup {
  const DeliveryGroup({
    required this.clientId,
    required this.clientName,
    required this.orders,
    this.stop,
  });

  final String clientId;
  final String clientName;

  /// 1-based place of the client in today's tournée; null = not on a route.
  final int? stop;
  final List<OrderSummary> orders;

  bool get onRoute => stop != null;
}

/// What the Livraisons tab shows: the groups in delivery order.
class DeliveriesBoard {
  const DeliveriesBoard({required this.groups, this.stops = const []});

  final List<DeliveryGroup> groups;

  /// Today's stops the order came from (with their saved points), for the map.
  final List<TodayStop> stops;

  /// Orders left to deliver (the tab's badge).
  int get count => groups.fold(0, (n, g) => n + g.orders.length);

  bool get isEmpty => groups.isEmpty;
}

/// Groups the livreur's confirmed [orders] by client. Clients who are a stop
/// of today's tournée ([stops], in route order) come first, in that order;
/// the others follow by client name. Inside a group, the oldest requested
/// date first, then the oldest order.
DeliveriesBoard groupDeliveries(
  List<OrderSummary> orders,
  List<TodayStop> stops,
) {
  final stopOf = <String, int>{};
  for (var i = 0; i < stops.length; i++) {
    stopOf.putIfAbsent(stops[i].client.id, () => i + 1);
  }
  final byClient = <String, List<OrderSummary>>{};
  for (final o in orders) {
    byClient.putIfAbsent(o.client.id, () => []).add(o);
  }
  final groups = [
    for (final e in byClient.entries)
      DeliveryGroup(
        clientId: e.key,
        clientName: e.value.first.client.name,
        stop: stopOf[e.key],
        orders: [...e.value]..sort(_byDate),
      ),
  ];
  groups.sort((a, b) {
    if (a.stop != null && b.stop != null) return a.stop!.compareTo(b.stop!);
    if (a.stop != null) return -1;
    if (b.stop != null) return 1;
    final byName = a.clientName.toLowerCase().compareTo(
      b.clientName.toLowerCase(),
    );
    return byName != 0 ? byName : a.clientId.compareTo(b.clientId);
  });
  return DeliveriesBoard(groups: groups, stops: stops);
}

int _byDate(OrderSummary a, OrderSummary b) {
  // `YYYY-MM-DD` sorts as text; an order without a date goes last.
  final ra = a.requestedDate ?? '9999';
  final rb = b.requestedDate ?? '9999';
  final c = ra.compareTo(rb);
  return c != 0 ? c : a.createdAt.compareTo(b.createdAt);
}
