import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/network/image_url.dart';
import '../../../catalog/data/models/product.dart';

/// A cart icon that a flying thumbnail can land on.
abstract interface class CartFlightTarget {
  /// Centre of the icon in global coordinates, or `null` when the icon is
  /// not the one the client sees (screen below in the stack, inactive tab,
  /// under a sheet, scrolled away).
  Offset? get visibleCenter;
}

/// Registry of the mounted cart icons. The last registered icon that is
/// visible wins (the top screen's), so pushing a screen with its own icon
/// retargets the flights without any wiring.
class CartIconTarget {
  CartIconTarget._();

  static final List<CartFlightTarget> _targets = [];

  static void register(CartFlightTarget target) => _targets.add(target);

  static void unregister(CartFlightTarget target) => _targets.remove(target);

  /// Centre of the visible cart icon, if any.
  static Offset? get visibleCenter {
    for (var i = _targets.length - 1; i >= 0; i--) {
      final center = _targets[i].visibleCenter;
      if (center != null) return center;
    }
    return null;
  }
}

/// Fly-to-cart: a small round thumbnail of the product arcs from where the
/// client tapped to the visible cart icon, and the icon (and the floating
/// cart bar) react when it lands.
///
/// While a flight is in the air, [deferring] is true: listeners of
/// `CartCubit.added` skip the event and wait for [impacts] instead, so the
/// feedback happens on impact, not at the tap.
class CartFlight {
  CartFlight._();

  static const Duration duration = Duration(milliseconds: 550);
  static const int maxConcurrent = 3;
  static const double thumbSize = 40;

  static int _inFlight = 0;
  static final StreamController<Product> _impacts =
      StreamController<Product>.broadcast(sync: true);

  /// True while at least one thumbnail is flying.
  static bool get deferring => _inFlight > 0;

  /// Fires when a thumbnail lands on the cart icon.
  static Stream<Product> get impacts => _impacts.stream;

  /// Runs [commit] (the real cart change) and launches a thumbnail from
  /// [origin] (the tapped button or the product photo) to the visible cart
  /// icon. Skips the flight, and lets the icon / floating bar react at once,
  /// with Reduce Motion, when no cart icon is visible, or when
  /// [maxConcurrent] thumbnails are already flying.
  ///
  /// [imageSize] is the variant the origin already shows, so the thumbnail
  /// comes from the image cache instead of the network.
  static void add(
    BuildContext origin, {
    required Product product,
    required VoidCallback commit,
    ImageSize? imageSize,
  }) {
    final from = _centerOf(origin);
    final overlay = Overlay.maybeOf(origin, rootOverlay: true);
    final target = CartIconTarget.visibleCenter;
    if (from == null ||
        overlay == null ||
        target == null ||
        _inFlight >= maxConcurrent ||
        MediaQuery.disableAnimationsOf(origin)) {
      commit();
      return;
    }
    final size = imageSize ?? _variantFor(origin);
    _inFlight++;
    // Deferring is on before the cart emits, so the icon and the bar wait.
    commit();
    late final OverlayEntry entry;
    var landed = false;
    void land({required bool impact}) {
      if (landed) return;
      landed = true;
      _inFlight--;
      if (entry.mounted) entry.remove();
      entry.dispose();
      if (impact) _impacts.add(product);
    }

    entry = OverlayEntry(
      builder: (_) => CartFlightThumb(
        product: product,
        from: from,
        to: target,
        imageSize: size,
        onLanded: () => land(impact: true),
        onDisposed: () => land(impact: false),
      ),
    );
    overlay.insert(entry);
  }

  /// Forgets in-flight bookkeeping between widget tests.
  @visibleForTesting
  static void reset() => _inFlight = 0;

  static Offset? _centerOf(BuildContext context) {
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return null;
    return box.localToGlobal(box.size.center(Offset.zero));
  }

  /// The variant a [NetImage] filling [context]'s box would have loaded.
  static ImageSize _variantFor(BuildContext context) {
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return ImageSize.medium;
    return ImageSize.forPixels(
      box.size.width * MediaQuery.devicePixelRatioOf(context),
    );
  }
}

/// The flying thumbnail. Public for the widget tests.
class CartFlightThumb extends StatefulWidget {
  const CartFlightThumb({
    super.key,
    required this.product,
    required this.from,
    required this.to,
    required this.imageSize,
    required this.onLanded,
    required this.onDisposed,
  });

  final Product product;
  final Offset from;

  /// Where the icon was at launch; followed live while flying, in case the
  /// header moves (collapsing product header, floating home header).
  final Offset to;
  final ImageSize imageSize;
  final VoidCallback onLanded;
  final VoidCallback onDisposed;

  @override
  State<CartFlightThumb> createState() => _CartFlightThumbState();
}

class _CartFlightThumbState extends State<CartFlightThumb>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: CartFlight.duration,
  );
  late final Animation<double> _path = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeInOutCubic,
  );
  late Offset _to = widget.to;

  @override
  void initState() {
    super.initState();
    _controller.forward().whenComplete(() {
      if (mounted) widget.onLanded();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    // Removed before landing (app torn down): release the bookkeeping.
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.onDisposed());
    super.dispose();
  }

  /// Quadratic Bézier from [from] to [to], its control point lifted above
  /// both ends so the thumbnail arcs up and drops into the icon.
  static Offset _bezier(Offset from, Offset to, double t) {
    final control = Offset(
      from.dx + (to.dx - from.dx) * 0.2,
      math.min(from.dy, to.dy) - 56,
    );
    final u = 1 - t;
    return from * (u * u) + control * (2 * u * t) + to * (t * t);
  }

  @override
  Widget build(BuildContext context) {
    final overlayBox = context.findAncestorRenderObjectOfType<RenderBox>();
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          // Follow the icon if it moved (cheap: one transform per frame).
          _to = CartIconTarget.visibleCenter ?? _to;
          final t = _path.value;
          var center = _bezier(widget.from, _to, t);
          if (overlayBox != null && overlayBox.hasSize) {
            center = overlayBox.globalToLocal(center);
          }
          final v = _controller.value;
          final scale = 1 - 0.65 * Curves.easeIn.transform(v);
          final opacity = v < 0.08
              ? v / 0.08
              : v > 0.8
              ? 1 - 0.4 * ((v - 0.8) / 0.2)
              : 1.0;
          const half = CartFlight.thumbSize / 2;
          return Stack(
            children: [
              Positioned(
                left: center.dx - half,
                top: center.dy - half,
                width: CartFlight.thumbSize,
                height: CartFlight.thumbSize,
                child: Opacity(
                  opacity: opacity,
                  child: Transform.scale(scale: scale, child: child),
                ),
              ),
            ],
          );
        },
        child: RepaintBoundary(child: _Thumb(widget: widget)),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.widget});

  final CartFlightThumb widget;

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final hasImage = product.mainImage != null || product.mainMedia != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: hasImage ? context.fieldFill : AppColors.yellow,
        border: Border.all(color: context.pageBackground, width: 2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: ClipOval(
        child: hasImage
            ? NetImage(
                url: product.mainImage,
                media: product.mainMedia,
                size: widget.imageSize,
              )
            : const Icon(
                Icons.shopping_bag_rounded,
                size: 20,
                color: AppColors.ink,
              ),
      ),
    );
  }
}
