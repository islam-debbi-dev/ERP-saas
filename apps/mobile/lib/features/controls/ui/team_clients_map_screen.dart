import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/config/app_env.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/helpers/url_helper.dart';
import '../../../core/localization/tr.dart';
import '../../../core/map/app_map.dart';
import '../../../core/map/client_map_repository.dart';
import '../../../core/map/client_map_sheet.dart';
import '../../../core/map/client_marker.dart';
import '../../../core/map/map_box.dart';
import '../../../core/map/map_layout.dart';
import '../../../core/map/map_list_toggle.dart' show MapNotice;
import '../../../core/models/json_converters.dart';
import '../../../core/network/api_result.dart';
import '../../team/data/team_repository.dart';

/// Contrôles → Carte: the supervisor's team clients (`GET /clients/map`, kept
/// to his team by the API), filtered by seller, "En dette", "Hors plafond".
/// Above the cap it reloads by view, like the web.
class TeamClientsMapScreen extends StatefulWidget {
  const TeamClientsMapScreen({super.key, this.today});

  /// Tests pin the day the team is read for.
  final String? today;

  @override
  State<TeamClientsMapScreen> createState() => _TeamClientsMapScreenState();
}

class _TeamClientsMapScreenState extends State<TeamClientsMapScreen> {
  ClientMapFilters _filters = const ClientMapFilters();
  ClientMapData? _whole;
  ClientMapData? _view;
  MapBox? _box;
  bool _loading = true;
  bool _failed = false;
  int _generation = 0;
  List<UserRef> _sellers = const [];

  @override
  void initState() {
    super.initState();
    _loadSellers();
    _load();
  }

  Future<void> _loadSellers() async {
    final day = widget.today ?? AlgiersDay.of();
    final result = await getIt<TeamRepository>().day(day);
    if (!mounted) return;
    if (result case Success(:final data)) {
      setState(() {
        _sellers = [for (final d in data) d.seller]
          ..sort((a, b) => a.fullName.compareTo(b.fullName));
      });
    }
  }

  /// The whole scope for the filters; the camera fits it.
  Future<void> _load() async {
    final gen = ++_generation;
    setState(() {
      _loading = true;
      _failed = false;
      _view = null;
      _box = null;
    });
    final result = await getIt<ClientMapRepository>().map(filters: _filters);
    if (!mounted || gen != _generation) return;
    setState(() {
      _loading = false;
      switch (result) {
        case Success(:final data):
          _whole = data;
        case Failure():
          _failed = true;
      }
    });
  }

  /// Above the cap only: the points of the visible box.
  Future<void> _onView(MapBox box) async {
    if (!(_whole?.truncated ?? false) || box == _box) return;
    _box = box;
    final gen = _generation;
    final result = await getIt<ClientMapRepository>().map(
      filters: _filters,
      box: box,
    );
    if (!mounted || gen != _generation || box != _box) return;
    if (result case Success(:final data)) setState(() => _view = data);
  }

  void _setFilters(ClientMapFilters f) {
    if (f == _filters) return;
    setState(() => _filters = f);
    _load();
  }

  Future<void> _pickSeller() async {
    final picked = await showModalBottomSheet<({String? id})>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheet).height * 0.7,
          ),
          child: ListView(
            shrinkWrap: true,
            children: [
              RadioGroup<String?>(
                groupValue: _filters.assignedSellerId,
                onChanged: (v) => Navigator.of(sheet).pop((id: v)),
                child: Column(
                  children: [
                    RadioListTile<String?>(
                      value: null,
                      title: Text(sheet.tr('map.all_sellers')),
                    ),
                    for (final s in _sellers)
                      RadioListTile<String?>(
                        value: s.id,
                        title: Text(
                          s.fullName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (picked == null) return;
    _setFilters(_filters.copyWith(assignedSellerId: () => picked.id));
  }

  void _open(ClientMapPoint p) {
    final dashboard = AppEnv.dashboardUrl;
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
      // No client screen in the supervisor's app: the dashboard's, as the
      // assistant's links do; hidden without DASHBOARD_URL.
      onOpen: dashboard.isEmpty
          ? null
          : () => UrlHelper.launchUrl(context, '$dashboard/clients/${p.id}'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final whole = _whole;
    final shown = _view ?? whole;
    final points = shown?.points ?? const <ClientMapPoint>[];
    final sellerName = [
      for (final s in _sellers)
        if (s.id == _filters.assignedSellerId) s.fullName,
    ].firstOrNull;

    final notices = <Widget>[
      if (_failed)
        MapNotice(
          icon: Icons.error_outline,
          text: context.tr('common.load_failed'),
          onTap: _load,
        ),
      if (!_loading && whole != null && whole.points.isEmpty)
        MapNotice(
          icon: Icons.location_searching,
          text: context.tr('map.no_points'),
        ),
      if (whole?.truncated ?? false)
        MapNotice(
          icon: Icons.zoom_in_rounded,
          text: context.tr('map.truncated'),
        ),
      if ((whole?.withoutLocation ?? 0) > 0)
        MapNotice(
          icon: Icons.location_off_outlined,
          text: context.tr(
            'map.without_position',
            args: {'n': Money.ltr('${whole!.withoutLocation}')},
          ),
        ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(context.tr('map.team_map'))),
      body: MapWithNotices(
        bottomInset: MediaQuery.paddingOf(context).bottom,
        notices: notices,
        map: Stack(
          children: [
            AppMap(
              fitPoints: [
                for (final p in whole?.points ?? const <ClientMapPoint>[])
                  LatLng(p.lat, p.lng),
              ],
              // A new whole-scope answer refits; a view reload does not.
              fitKey: identityHashCode(whole),
              onViewChanged: _onView,
              layers: [
                MarkerLayer(
                  markers: [
                    for (final p in points)
                      Marker(
                        point: LatLng(p.lat, p.lng),
                        width: markerSize,
                        height: markerSize,
                        child: ClientMarker(
                          key: ValueKey('team-${p.id}'),
                          state: markerState(
                            balance: p.balance,
                            overLimit: p.overLimit,
                          ),
                          label: p.name,
                          onTap: () => _open(p),
                        ),
                      ),
                  ],
                ),
              ],
            ),
            MapTopBar(
              children: [
                if (_sellers.isNotEmpty)
                  ActionChip(
                    avatar: const Icon(Icons.person_outline, size: 18),
                    label: Text(
                      sellerName ?? context.tr('map.all_sellers'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    backgroundColor: Theme.of(context).colorScheme.surface,
                    elevation: 2,
                    onPressed: _pickSeller,
                  ),
                MapChip(
                  label: context.tr('map.filter_debt'),
                  selected: _filters.hasDebt,
                  onSelected: (on) =>
                      _setFilters(_filters.copyWith(hasDebt: on)),
                ),
                MapChip(
                  label: context.tr('map.filter_over'),
                  selected: _filters.overLimit,
                  onSelected: (on) =>
                      _setFilters(_filters.copyWith(overLimit: on)),
                ),
              ],
            ),
            if (_loading)
              const PositionedDirectional(
                top: 0,
                start: 0,
                end: 0,
                child: LinearProgressIndicator(minHeight: 3),
              ),
          ],
        ),
      ),
    );
  }
}
