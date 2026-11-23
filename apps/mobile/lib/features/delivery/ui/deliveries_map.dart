import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/map/app_map.dart';
import '../../../core/map/client_map_repository.dart';
import '../../../core/map/client_map_sheet.dart';
import '../../../core/map/client_marker.dart';
import '../../../core/map/map_layout.dart';
import '../../../core/map/map_list_toggle.dart' show MapNotice;
import '../../../core/network/api_result.dart';
import '../../clients/data/models/client.dart';
import '../../clients/data/repo/clients_repository.dart';
import '../../orders/data/models/order.dart';
import '../logic/delivery_groups.dart';
import '../logic/delivery_points.dart';

/// Most clients read one by one when the map answer was cut at its cap.
const _maxFetched = 30;

/// The livreur's deliveries on a map: one marker per client, numbered like
/// the list, with the number of orders on its badge. Tap → the client's
/// sheet with his orders, each with "Livrer".
class DeliveriesMap extends StatefulWidget {
  const DeliveriesMap({
    super.key,
    required this.board,
    required this.onRefresh,
    this.onOpenOrder,
    this.onOpenClient,
  });

  final DeliveriesBoard board;
  final Future<void> Function() onRefresh;
  final void Function(OrderSummary order)? onOpenOrder;
  final void Function(String clientId)? onOpenClient;

  @override
  State<DeliveriesMap> createState() => _DeliveriesMapState();
}

class _DeliveriesMapState extends State<DeliveriesMap> {
  ClientMapData? _map;
  final Map<String, Client> _fetched = {};
  bool _showWithout = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(DeliveriesMap old) {
    super.didUpdateWidget(old);
    // A reload may bring a new client: read only what is still unknown.
    if (!identical(old.board, widget.board) && _map != null) _fetchMissing();
  }

  Future<void> _load() async {
    final result = await getIt<ClientMapRepository>().map(
      filters: const ClientMapFilters(includeInactive: true),
    );
    if (!mounted) return;
    setState(
      () => _map = result is Success<ClientMapData> ? result.data : null,
    );
    await _fetchMissing();
  }

  Future<void> _fetchMissing() async {
    final ids = clientsToFetch(
      widget.board.groups,
      stops: widget.board.stops,
      map: _map,
    ).where((id) => !_fetched.containsKey(id)).take(_maxFetched).toList();
    if (ids.isEmpty) return;
    final repo = getIt<ClientsRepository>();
    final results = await Future.wait(ids.map(repo.get));
    if (!mounted) return;
    setState(() {
      for (final r in results) {
        if (r case Success(:final data)) _fetched[data.id] = data;
      }
    });
  }

  Future<void> _refresh() async {
    await widget.onRefresh();
    await _load();
  }

  void _open(DeliveryPin pin) {
    final g = pin.group;
    final first = g.orders.isEmpty ? null : g.orders.first.client;
    showClientMapSheet(
      context,
      client: MapClient(
        id: g.clientId,
        name: g.clientName,
        code: pin.code ?? first?.code,
        commune: pin.commune,
        phone: pin.phone,
        balance: pin.balance ?? Decimal.zero,
        lat: pin.point!.latitude,
        lng: pin.point!.longitude,
      ),
      onOpen: widget.onOpenClient == null
          ? null
          : () => widget.onOpenClient!(g.clientId),
      extra: (sheet) => _Orders(
        orders: g.orders,
        onDeliver: widget.onOpenOrder == null
            ? null
            : (o) {
                Navigator.of(sheet).pop();
                widget.onOpenOrder!(o);
              },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pins = deliveryPins(
      widget.board.groups,
      stops: widget.board.stops,
      mapPoints: _map?.byId ?? const {},
      fetched: _fetched,
    );
    final placed = [
      for (final p in pins)
        if (p.point != null) p,
    ];
    final without = [
      for (final p in pins)
        if (p.point == null) p,
    ];
    // Still reading the points: no "sans position" yet.
    final settled = _map != null || _fetched.isNotEmpty;
    final notices = <Widget>[
      if (settled && without.isNotEmpty) ...[
        MapNotice(
          icon: Icons.location_off_outlined,
          text: context.tr(
            'map.without_position',
            args: {'n': Money.ltr('${without.length}')},
          ),
          onTap: () => setState(() => _showWithout = !_showWithout),
        ),
        if (_showWithout)
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 150),
            child: Material(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: AppRadius.mdAll,
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                children: [
                  for (final w in without)
                    ListTile(
                      dense: true,
                      title: Text(
                        w.group.clientName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Text(
                        Money.ltr('${w.group.orders.length}'),
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      onTap: widget.onOpenClient == null
                          ? null
                          : () => widget.onOpenClient!(w.group.clientId),
                    ),
                ],
              ),
            ),
          ),
      ],
    ];
    return MapWithNotices(
      bottomInset: tabBarInset(context),
      notices: notices,
      map: Stack(
        children: [
          AppMap(
            fitPoints: [for (final p in placed) p.point!],
            fitKey: placed.length,
            layers: [
              MarkerLayer(
                markers: [
                  for (final p in placed)
                    Marker(
                      point: p.point!,
                      width: markerSize,
                      height: markerSize,
                      child: ClientMarker(
                        key: ValueKey('delivery-${p.group.clientId}'),
                        state: markerState(
                          balance: p.balance ?? Decimal.zero,
                          overLimit: p.overLimit,
                        ),
                        number: p.group.stop,
                        icon: p.group.onRoute ? null : Icons.storefront,
                        badge: p.group.orders.length,
                        label: p.group.clientName,
                        onTap: () => _open(p),
                      ),
                    ),
                ],
              ),
            ],
          ),
          MapTopBar(
            children: [
              AppRoundIconButton(
                icon: Icons.refresh_rounded,
                tooltip: context.tr('map.refresh'),
                onPressed: _refresh,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The client's orders in the sheet, each with "Livrer".
class _Orders extends StatelessWidget {
  const _Orders({required this.orders, this.onDeliver});

  final List<OrderSummary> orders;
  final void Function(OrderSummary order)? onDeliver;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(context.tr('map.orders_title'), style: text.titleSmall),
        for (final o in orders)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        o.number ?? context.tr('order.no_number'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        style: text.bodyMedium,
                      ),
                      AmountText(o.totalTtc, style: text.bodySmall),
                    ],
                  ),
                ),
                if (onDeliver != null) ...[
                  AppSpacing.gapSm,
                  AppButton(
                    label: context.tr('map.deliver'),
                    icon: Icons.local_shipping_outlined,
                    expand: false,
                    onPressed: () => onDeliver!(o),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}
