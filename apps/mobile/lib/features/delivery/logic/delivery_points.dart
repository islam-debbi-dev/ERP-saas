import 'package:decimal/decimal.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/map/client_map_repository.dart';
import '../../clients/data/models/client.dart';
import '../../today/data/models/today.dart';
import 'delivery_groups.dart';

/// A client of the Livraisons tab placed on the map (or not: [point] null).
class DeliveryPin {
  const DeliveryPin({
    required this.group,
    this.point,
    this.balance,
    this.overLimit = false,
    this.code,
    this.commune,
    this.phone,
  });

  final DeliveryGroup group;
  final LatLng? point;

  /// Null when no source gave it (no map answer, no stop, no detail).
  final Decimal? balance;
  final bool overLimit;
  final String? code;
  final String? commune;
  final String? phone;
}

/// Joins the livreur's groups to a point and a balance: the map answer
/// first (current point, plafond), then today's stop, then a client read
/// one by one ([fetched]) when the map answer was cut at its cap.
List<DeliveryPin> deliveryPins(
  List<DeliveryGroup> groups, {
  List<TodayStop> stops = const [],
  Map<String, ClientMapPoint> mapPoints = const {},
  Map<String, Client> fetched = const {},
}) {
  final stopOf = {for (final s in stops) s.client.id: s};
  return [
    for (final g in groups)
      _pin(g, mapPoints[g.clientId], stopOf[g.clientId], fetched[g.clientId]),
  ];
}

DeliveryPin _pin(DeliveryGroup g, ClientMapPoint? m, TodayStop? s, Client? c) {
  final orderPhone = g.orders.isEmpty ? null : g.orders.first.client.phone;
  if (m != null) {
    return DeliveryPin(
      group: g,
      point: LatLng(m.lat, m.lng),
      balance: m.balance,
      overLimit: m.overLimit,
      code: m.code,
      commune: m.commune,
      phone: m.phone ?? orderPhone,
    );
  }
  final stopPoint = s?.client.lat != null && s?.client.lng != null
      ? LatLng(s!.client.lat!, s.client.lng!)
      : null;
  final loc = c?.location;
  return DeliveryPin(
    group: g,
    point: stopPoint ?? (loc == null ? null : LatLng(loc.lat, loc.lng)),
    balance: c?.balance ?? s?.balance,
    overLimit: c?.overLimit ?? false,
    code: c?.code ?? s?.client.code,
    commune: c?.commune ?? s?.client.commune,
    phone: c?.phone ?? s?.client.phone ?? orderPhone,
  );
}

/// The clients still to read one by one: none when the map answer is
/// complete (a client missing from it has no point), all the unplaced ones
/// when it was cut at its cap or failed.
List<String> clientsToFetch(
  List<DeliveryGroup> groups, {
  required List<TodayStop> stops,
  required ClientMapData? map,
}) {
  if (map != null && !map.truncated) return const [];
  final placed = {
    ...?map?.points.map((p) => p.id),
    for (final s in stops)
      if (s.client.lat != null && s.client.lng != null) s.client.id,
  };
  return [
    for (final g in groups)
      if (!placed.contains(g.clientId)) g.clientId,
  ];
}
