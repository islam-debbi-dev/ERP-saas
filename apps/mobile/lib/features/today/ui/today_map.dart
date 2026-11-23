import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/localization/tr.dart';
import '../../../core/map/app_map.dart';
import '../../../core/map/client_map_repository.dart';
import '../../../core/map/client_map_sheet.dart';
import '../../../core/map/client_marker.dart';
import '../../../core/map/map_box.dart';
import '../../../core/map/map_layout.dart';
import '../../../core/map/map_list_toggle.dart';
import '../../../core/network/api_result.dart';
import '../../../core/helpers/money.dart';
import '../data/models/today.dart';

extension StopPoint on TodayStop {
  LatLng? get point => client.lat == null || client.lng == null
      ? null
      : LatLng(client.lat!, client.lng!);
}

/// The seller's day on a map: today's stops numbered in route order and
/// joined by a line, visited ones grey; the "Clients" layer adds the rest of
/// his clients (`GET /clients/map`, his scope). Stops without a point are
/// counted under the map.
class TodayMap extends StatefulWidget {
  const TodayMap({
    super.key,
    required this.today,
    required this.onRefresh,
    this.onOpenStop,
    this.onOpenClient,
  });

  final Today today;
  final Future<void> Function() onRefresh;
  final void Function(TodayStop stop)? onOpenStop;

  /// A client of the layer (not a stop of today).
  final void Function(String clientId)? onOpenClient;

  @override
  State<TodayMap> createState() => _TodayMapState();
}

class _TodayMapState extends State<TodayMap> {
  ClientMapData? _clients;
  bool _clientsFailed = false;
  bool _layer = false;
  bool _showWithout = false;
  MapBox? _box;

  /// Over-limit flags seen in any `/clients/map` answer: `/me/today` has no
  /// plafond, so a stop turns red only once the map knows.
  final Map<String, bool> _overLimit = {};

  @override
  void initState() {
    super.initState();
    _loadClients();
  }

  Future<void> _loadClients({MapBox? box}) async {
    final result = await getIt<ClientMapRepository>().map(box: box);
    if (!mounted) return;
    setState(() {
      switch (result) {
        case Success(:final data):
          _clients = data;
          _clientsFailed = false;
          for (final p in data.points) {
            _overLimit[p.id] = p.overLimit;
          }
        case Failure():
          _clientsFailed = true;
      }
    });
  }

  void _onView(MapBox box) {
    // Only above the cap does the view matter (as the web does).
    if (!_layer || !(_clients?.truncated ?? false) || box == _box) return;
    _box = box;
    _loadClients(box: box);
  }

  Future<void> _refresh() async {
    await widget.onRefresh();
    _box = null;
    await _loadClients();
  }

  void _openStop(TodayStop stop) {
    final c = stop.client;
    showClientMapSheet(
      context,
      client: MapClient(
        id: c.id,
        name: c.name,
        code: c.code,
        commune: c.commune,
        phone: c.phone,
        balance: stop.balance,
        lat: c.lat!,
        lng: c.lng!,
      ),
      onOpen: widget.onOpenStop == null ? null : () => widget.onOpenStop!(stop),
    );
  }

  void _openPoint(ClientMapPoint p) {
    showClientMapSheet(
      context,
      client: MapClient(
        id: p.id,
        name: p.name,
        code: p.code,
        commune: p.commune,
        phone: p.phone,
        balance: p.balance,
        lat: p.lat,
        lng: p.lng,
      ),
      onOpen: widget.onOpenClient == null
          ? null
          : () => widget.onOpenClient!(p.id),
    );
  }

  @override
  Widget build(BuildContext context) {
    final stops = widget.today.stops;
    final stopIds = {for (final s in stops) s.client.id};
    final placed = [
      for (var i = 0; i < stops.length; i++)
        if (stops[i].point != null) (n: i + 1, stop: stops[i]),
    ];
    final without = [
      for (var i = 0; i < stops.length; i++)
        if (stops[i].point == null) (n: i + 1, stop: stops[i]),
    ];
    final others = _layer
        ? [
            for (final p in _clients?.points ?? const <ClientMapPoint>[])
              if (!stopIds.contains(p.id)) p,
          ]
        : const <ClientMapPoint>[];
    final route = [for (final s in placed) s.stop.point!];
    final fitPoints = route.isNotEmpty
        ? route
        : [for (final p in others) LatLng(p.lat, p.lng)];

    final notices = <Widget>[
      if (_layer && (_clients?.truncated ?? false))
        MapNotice(
          icon: Icons.zoom_in_rounded,
          text: context.tr('map.truncated'),
        ),
      if (_layer && _clientsFailed)
        MapNotice(
          icon: Icons.error_outline,
          text: context.tr('common.load_failed'),
          onTap: () => _loadClients(box: _box),
        ),
      if (without.isNotEmpty) ...[
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
                      leading: Text(
                        '${w.n}',
                        textDirection: TextDirection.ltr,
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      title: Text(
                        w.stop.client.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: widget.onOpenStop == null
                          ? null
                          : () => widget.onOpenStop!(w.stop),
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
            fitPoints: fitPoints,
            fitKey: '${widget.today.day}:${route.length}:${others.isEmpty}',
            onViewChanged: _onView,
            layers: [
              if (route.length > 1)
                PolylineLayer(
                  polylines: [
                    Polyline(
                      points: route,
                      color: mapAccent.withValues(alpha: 0.7),
                      strokeWidth: 3,
                    ),
                  ],
                ),
              if (others.isNotEmpty)
                MarkerLayer(
                  markers: [
                    for (final p in others)
                      Marker(
                        point: LatLng(p.lat, p.lng),
                        width: markerSize,
                        height: markerSize,
                        child: ClientMarker(
                          key: ValueKey('client-${p.id}'),
                          state: markerState(
                            balance: p.balance,
                            overLimit: p.overLimit,
                          ),
                          label: p.name,
                          onTap: () => _openPoint(p),
                        ),
                      ),
                  ],
                ),
              MarkerLayer(
                markers: [
                  for (final s in placed)
                    Marker(
                      point: s.stop.point!,
                      width: markerSize,
                      height: markerSize,
                      child: ClientMarker(
                        key: ValueKey('stop-${s.stop.client.id}'),
                        state: markerState(
                          balance: s.stop.balance,
                          overLimit: _overLimit[s.stop.client.id] ?? false,
                          visited: s.stop.visitedToday,
                        ),
                        number: s.n,
                        label: s.stop.client.name,
                        onTap: () => _openStop(s.stop),
                      ),
                    ),
                ],
              ),
            ],
          ),
          MapTopBar(
            children: [
              MapChip(
                label: context.tr('map.layer_clients'),
                icon: Icons.groups_outlined,
                selected: _layer,
                onSelected: (on) => setState(() => _layer = on),
              ),
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
