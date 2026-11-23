import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../config/app_env.dart';
import '../design/design.dart';
import '../geo/geo_capture.dart';
import '../geo/geo_fix.dart';
import '../localization/tr.dart';
import 'map_box.dart';

/// Where the tiles come from. Tests swap in a provider that never touches
/// the network.
class MapTiles {
  MapTiles._();

  /// The package name the tile servers see in the User-Agent (OSM's policy
  /// asks for an identifiable client).
  static const userAgentPackageName = 'com.debvora.app';

  @visibleForTesting
  static TileProvider Function()? testProvider;

  static TileLayer layer(TileProvider provider) {
    final url = AppEnv.mapTileUrl;
    return TileLayer(
      urlTemplate: url,
      subdomains: url.contains('{s}') ? const ['a', 'b', 'c'] : const [],
      userAgentPackageName: userAgentPackageName,
      tileProvider: provider,
      maxNativeZoom: 19,
      tileDisplay: testProvider != null
          ? const TileDisplay.instantaneous()
          : const TileDisplay.fadeIn(),
    );
  }

  static TileProvider provider() =>
      testProvider?.call() ?? NetworkTileProvider();
}

/// Algeria, when there is nothing to show yet.
const _algeria = LatLng(28.0, 2.6);

/// The app's map: tiles from MAP_TILE_URL with their credit, the caller's
/// [layers], "Ma position" (read once on a tap, kept in memory, never sent)
/// and "Recentrer". Rotation is off; the map is never inside a pull to
/// refresh, so a drag always pans.
class AppMap extends StatefulWidget {
  const AppMap({
    super.key,
    required this.fitPoints,
    this.fitKey,
    this.layers = const [],
    this.onViewChanged,
    this.bottomInset = 0,
    this.showControls = true,
    this.maxFitZoom = 16,
  });

  /// What "Recentrer" and the first view show.
  final List<LatLng> fitPoints;

  /// The camera fits [fitPoints] again when this changes (new data), and not
  /// on every rebuild (a view-box reload must not move the camera).
  final Object? fitKey;
  final List<Widget> layers;

  /// The visible box after a pan or zoom, debounced and rounded.
  final ValueChanged<MapBox>? onViewChanged;

  /// Room left at the bottom for what floats over the map (the tab bar).
  final double bottomInset;
  final bool showControls;
  final double maxFitZoom;

  @override
  State<AppMap> createState() => _AppMapState();
}

class _AppMapState extends State<AppMap> {
  final _controller = MapController();
  late final TileProvider _tiles = MapTiles.provider();
  Timer? _viewDebounce;
  bool _ready = false;
  GeoFix? _me;
  bool _locating = false;

  @override
  void didUpdateWidget(AppMap old) {
    super.didUpdateWidget(old);
    if (old.fitKey != widget.fitKey && _ready) _fit();
  }

  @override
  void dispose() {
    _viewDebounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  CameraFit? _cameraFit() {
    final pts = widget.fitPoints;
    if (pts.isEmpty) return null;
    return CameraFit.coordinates(
      coordinates: pts.length == 1 ? [pts.single, pts.single] : pts,
      padding: const EdgeInsets.all(48),
      maxZoom: widget.maxFitZoom,
    );
  }

  void _fit() {
    final fit = _cameraFit();
    if (fit != null) {
      _controller.fitCamera(fit);
    } else if (_me != null) {
      _controller.move(LatLng(_me!.lat, _me!.lng), 15);
    }
  }

  void _onPosition(MapCamera camera, bool hasGesture) {
    final cb = widget.onViewChanged;
    if (cb == null) return;
    _viewDebounce?.cancel();
    _viewDebounce = Timer(const Duration(milliseconds: 400), () {
      final box = MapBox.around(camera.visibleBounds);
      if (box != null && mounted) cb(box);
    });
  }

  Future<void> _locate() async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    final noFix = context.tr('geo.no_fix');
    setState(() => _locating = true);
    final fix = await captureGeo(context);
    if (!mounted) return;
    setState(() {
      _locating = false;
      _me = fix ?? _me;
    });
    if (fix == null) {
      messenger?.showSnackBar(SnackBar(content: Text(noFix)));
      return;
    }
    _controller.move(
      LatLng(fix.lat, fix.lng),
      math.max(_controller.camera.zoom, 15),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fit = _cameraFit();
    final me = _me;
    return Stack(
      children: [
        FlutterMap(
          mapController: _controller,
          options: MapOptions(
            initialCameraFit: fit,
            initialCenter: _algeria,
            initialZoom: 5,
            minZoom: 3,
            maxZoom: 19,
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
            ),
            onMapReady: () => _ready = true,
            onPositionChanged: _onPosition,
          ),
          children: [
            MapTiles.layer(_tiles),
            ...widget.layers,
            if (me != null) ...myPositionLayers(me),
          ],
        ),
        PositionedDirectional(
          start: AppSpacing.sm,
          bottom: widget.bottomInset + AppSpacing.xs,
          child: const MapAttribution(),
        ),
        if (widget.showControls)
          PositionedDirectional(
            end: AppSpacing.md,
            bottom: widget.bottomInset + AppSpacing.xl,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _locating
                    ? const SizedBox(
                        width: 46,
                        height: 46,
                        child: Padding(
                          padding: EdgeInsets.all(12),
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : AppRoundIconButton(
                        icon: Icons.my_location,
                        tooltip: context.tr('map.my_position'),
                        onPressed: _locate,
                      ),
                AppSpacing.gapSm,
                AppRoundIconButton(
                  icon: Icons.fit_screen_outlined,
                  tooltip: context.tr('map.recenter'),
                  onPressed: _fit,
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// The blue dot and its accuracy circle.
List<Widget> myPositionLayers(GeoFix me) {
  final at = LatLng(me.lat, me.lng);
  return [
    CircleLayer(
      circles: [
        CircleMarker(
          point: at,
          radius: me.accuracyM.clamp(5, 2000).toDouble(),
          useRadiusInMeter: true,
          color: mapBlue.withValues(alpha: 0.12),
          borderColor: mapBlue.withValues(alpha: 0.4),
          borderStrokeWidth: 1,
        ),
      ],
    ),
    MarkerLayer(
      markers: [
        Marker(point: at, width: 22, height: 22, child: const MyPositionDot()),
      ],
    ),
  ];
}

/// "Ma position" blue.
const mapBlue = Color(0xFF0A84FF);

class MyPositionDot extends StatelessWidget {
  const MyPositionDot({super.key});

  @override
  Widget build(BuildContext context) => Semantics(
    label: context.tr('map.my_position'),
    child: Container(
      decoration: BoxDecoration(
        color: mapBlue,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 3)],
      ),
    ),
  );
}

/// The tile provider's credit (MAP_TILE_ATTRIBUTION), always visible.
class MapAttribution extends StatelessWidget {
  const MapAttribution({super.key});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.8),
      borderRadius: BorderRadius.circular(3),
    ),
    child: Text(
      AppEnv.mapTileAttribution,
      textDirection: TextDirection.ltr,
      style: const TextStyle(fontSize: 10, color: Color(0xFF333333)),
    ),
  );
}

/// A small map in a card (location requests, GPS alerts): no gestures, so
/// it never fights the list's scroll or its pull to refresh.
class MiniMap extends StatefulWidget {
  const MiniMap({
    super.key,
    required this.points,
    this.layers = const [],
    this.height = 160,
  });

  final List<LatLng> points;
  final List<Widget> layers;
  final double height;

  @override
  State<MiniMap> createState() => _MiniMapState();
}

class _MiniMapState extends State<MiniMap> {
  late final TileProvider _tiles = MapTiles.provider();

  @override
  Widget build(BuildContext context) {
    final pts = widget.points;
    return SizedBox(
      height: widget.height,
      child: ClipRRect(
        borderRadius: AppRadius.mdAll,
        child: Stack(
          children: [
            IgnorePointer(
              child: FlutterMap(
                options: MapOptions(
                  initialCameraFit: pts.isEmpty
                      ? null
                      : CameraFit.coordinates(
                          coordinates: pts.length == 1 ? [pts[0], pts[0]] : pts,
                          padding: const EdgeInsets.all(32),
                          maxZoom: 17,
                        ),
                  initialCenter: pts.isEmpty ? _algeria : pts.first,
                  initialZoom: pts.isEmpty ? 5 : 16,
                  interactionOptions: const InteractionOptions(
                    flags: InteractiveFlag.none,
                  ),
                ),
                children: [MapTiles.layer(_tiles), ...widget.layers],
              ),
            ),
            const PositionedDirectional(
              start: AppSpacing.xs,
              bottom: AppSpacing.xs,
              child: MapAttribution(),
            ),
          ],
        ),
      ),
    );
  }
}

/// A plain dot for the mini maps.
Marker dotMarker(LatLng at, Color color, {required String label}) => Marker(
  point: at,
  width: 22,
  height: 22,
  child: Semantics(
    label: label,
    child: Container(
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 3)],
      ),
    ),
  ),
);
