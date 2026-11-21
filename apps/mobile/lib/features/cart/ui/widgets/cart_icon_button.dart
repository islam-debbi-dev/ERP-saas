import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/router/routes.dart';
import '../../../catalog/data/models/product.dart';
import '../../logic/cart_cubit.dart';
import 'cart_flight.dart';
import 'qty_stepper.dart';

/// Cart icon with a yellow count badge; opens the cart.
///
/// When a product is added it says "I'm here": the bag pops and tilts as if
/// it caught the product, one soft yellow ring leaves it, the disc warms up
/// and the count rolls to the new number. With a fly-to-cart thumbnail in
/// the air ([CartFlight]) all of this waits for the impact.
///
/// One [AnimationController] drives every layer through [Interval]s; see
/// [_Motion] for the timeline.
class CartIconButton extends StatefulWidget {
  const CartIconButton({super.key, this.discOpacity = 1});

  /// 0 draws a plain icon (inside a translucent bar), 1 the round disc that
  /// stays readable on photos.
  final double discOpacity;

  static const double size = 46;

  @override
  State<CartIconButton> createState() => _CartIconButtonState();
}

class _CartIconButtonState extends State<CartIconButton>
    with SingleTickerProviderStateMixin
    implements CartFlightTarget {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: _Motion.full,
  );
  final List<StreamSubscription<Product>> _subs = [];

  /// The count the badge shows; lags behind the cart while a thumbnail is
  /// flying so the number changes on impact.
  int? _shown;

  /// What the current sequence animates from / plays.
  _Sequence _sequence = const _Sequence.idle();
  DateTime? _lastPlay;
  DateTime? _lastRing;

  @override
  void initState() {
    super.initState();
    CartIconTarget.register(this);
    final cart = context.read<CartCubit>();
    _subs
      ..add(
        cart.added.listen((product) {
          if (!CartFlight.deferring) _onAdded();
        }),
      )
      ..add(CartFlight.impacts.listen((_) => _onAdded()));
  }

  @override
  void dispose() {
    CartIconTarget.unregister(this);
    for (final sub in _subs) {
      sub.cancel();
    }
    _controller.dispose();
    super.dispose();
  }

  /// The client sees this icon: its screen is on top (no route or sheet
  /// over it, active tab) and it is laid out inside the window.
  bool get _isVisible {
    if (!mounted || !TickerMode.valuesOf(context).enabled) return false;
    BuildContext? c = context;
    while (c != null) {
      final route = ModalRoute.of(c);
      if (route != null && !route.isCurrent) return false;
      final navigator = c.findAncestorStateOfType<NavigatorState>();
      c = navigator?.context;
    }
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return false;
    final rect = box.localToGlobal(Offset.zero) & box.size;
    final screen = Offset.zero & MediaQuery.sizeOf(context);
    return screen.overlaps(rect);
  }

  @override
  Offset? get visibleCenter {
    if (!_isVisible) return null;
    final box = context.findRenderObject()! as RenderBox;
    return box.localToGlobal(box.size.center(Offset.zero));
  }

  int get _liveCount => context.read<CartCubit>().state.lineCount;

  void _onAdded() {
    if (!mounted) return;
    final from = _shown ?? 0;
    final to = _liveCount;
    if (!_isVisible) {
      // Screens below keep their number right without running a ticker.
      setState(() => _shown = to);
      return;
    }
    final now = DateTime.now();
    final reduce = MediaQuery.disableAnimationsOf(context);
    final repeat =
        _lastPlay != null &&
        now.difference(_lastPlay!) < _Motion.full + _Motion.repeatGrace;
    final ring =
        !reduce &&
        (_lastRing == null || now.difference(_lastRing!) >= _Motion.ringGap);
    // A ring still fading keeps going when the restart has no ring of its own.
    final ringOffset = ring || _lastRing == null
        ? Duration.zero
        : now.difference(_lastRing!);
    if (ring) _lastRing = now;
    _lastPlay = now;

    setState(() {
      _sequence = _Sequence(
        reduce: reduce,
        light: repeat,
        fromCount: from,
        toCount: to,
        scaleFrom: _sequence.scaleAt(_controller.value),
        tintFrom: _sequence.tintAt(_controller.value),
        ring: ring,
        ringOffset: ringOffset,
      );
      _shown = to;
    });
    _controller.duration = _sequence.duration;
    _controller.forward(from: 0);

    final direction = Directionality.of(context);
    final message = context.tr('jb.cart.added_announce', args: {'count': to});
    SemanticsService.sendAnnouncement(View.of(context), message, direction);
  }

  @override
  Widget build(BuildContext context) {
    final live = cartLineCount(context);
    // Removals, a restored cart and adds without a thumbnail update at once;
    // an add whose thumbnail is still flying waits for the impact.
    final shown = _shown;
    if (shown == null ||
        live < shown ||
        (live > shown && !CartFlight.deferring)) {
      _shown = live;
    }
    final count = _shown ?? live;
    final rtl = Directionality.of(context) == TextDirection.rtl;

    return Semantics(
      button: true,
      label: count > 0
          ? context.tr('jb.cart.icon_label', args: {'count': count})
          : context.tr('jb.cart.title'),
      excludeSemantics: true,
      onTap: () => context.push(Routes.cart),
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final v = _controller.value;
            final s = _sequence;
            return _Frame(
              discOpacity: widget.discOpacity,
              count: count,
              fromCount: s.fromCount,
              scale: s.scaleAt(v),
              tilt: s.tiltAt(v) * (rtl ? -1 : 1),
              tint: s.tintAt(v),
              ring: s.ringAt(v),
              badgeIn: s.badgeInAt(v),
              roll: s.rollAt(v),
              crossFade: s.reduce,
              onTap: () => context.push(Routes.cart),
            );
          },
        ),
      ),
    );
  }
}

/// The timeline, in ms from the add (or the impact):
///
/// | layer      | first add                                   | repeat add (< 0.9 s)           |
/// |------------|---------------------------------------------|--------------------------------|
/// | bag scale  | 0–150 1→1.18 easeOutBack, 150–650 easeOut   | 0–110 →1.10, 110–480 easeOut   |
/// | bag tilt   | 0–110 →−6°, 110–300 →+3°, 300–520 →0        | none                           |
/// | ring       | 0–450 ×1→1.8, 35 %→0 α, easeOutCubic        | only ≥ 400 ms after the last   |
/// | warm tint  | 40–160 in, 160–650 out                      | same, from the current tint    |
/// | badge      | 0→1: 60–420 scale spring; else 80–380 roll  | roll                           |
///
/// Reduce Motion: 0–300 tint in / out and a cross-fade of the number only.
abstract final class _Motion {
  static const full = Duration(milliseconds: 650);
  static const light = Duration(milliseconds: 480);
  static const reduced = Duration(milliseconds: 300);
  static const ring = Duration(milliseconds: 450);
  static const ringGap = Duration(milliseconds: 400);
  static const repeatGrace = Duration(milliseconds: 250);

  /// Springs past the target once (~8 %), for the badge appearing.
  static const settle = Cubic(0.34, 1.45, 0.64, 1);
}

/// Parameters of one play of the sequence, and the value of every layer at
/// controller value `v` (0..1 over [duration]).
class _Sequence {
  const _Sequence({
    required this.reduce,
    required this.light,
    required this.fromCount,
    required this.toCount,
    required this.scaleFrom,
    required this.tintFrom,
    required this.ring,
    required this.ringOffset,
  });

  const _Sequence.idle()
    : reduce = false,
      light = false,
      fromCount = null,
      toCount = null,
      scaleFrom = 1,
      tintFrom = 0,
      ring = false,
      ringOffset = Duration.zero;

  final bool reduce;
  final bool light;
  final int? fromCount;
  final int? toCount;

  /// Scale / tint the icon had when this play started (no jump on restart).
  final double scaleFrom;
  final double tintFrom;

  /// This play launches a ring; otherwise a ring from the previous play may
  /// still be fading, [ringOffset] ms into its life.
  final bool ring;
  final Duration ringOffset;

  bool get idle => toCount == null;

  Duration get duration => reduce
      ? _Motion.reduced
      : light
      ? _Motion.light
      : _Motion.full;

  double _ms(double v) => v * duration.inMilliseconds;

  static double _seg(double ms, double start, double end) =>
      ((ms - start) / (end - start)).clamp(0.0, 1.0);

  double scaleAt(double v) {
    if (idle || reduce || v >= 1) return 1;
    final ms = _ms(v);
    final peak = light ? 1.10 : 1.18;
    final up = light ? 110.0 : 150.0;
    final end = duration.inMilliseconds.toDouble();
    if (ms <= up) {
      final t = (light ? Curves.easeOutCubic : Curves.easeOutBack).transform(
        _seg(ms, 0, up),
      );
      return scaleFrom + (peak - scaleFrom) * t;
    }
    // easeOutBack's small overshoot above the peak is the one overshoot;
    // the bag then settles without dipping under its size.
    return peak + (1 - peak) * Curves.easeOutCubic.transform(_seg(ms, up, end));
  }

  /// Radians; positive tilts the top of the bag towards the reading end.
  double tiltAt(double v) {
    if (idle || reduce || light || v >= 1) return 0;
    final ms = _ms(v);
    const deg = math.pi / 180;
    if (ms <= 110) return -6 * deg * Curves.easeOut.transform(_seg(ms, 0, 110));
    if (ms <= 300) {
      return (-6 + 9 * Curves.easeInOut.transform(_seg(ms, 110, 300))) * deg;
    }
    return 3 * deg * (1 - Curves.easeOut.transform(_seg(ms, 300, 520)));
  }

  /// 0..1 warm yellow tint of the disc (or of the bare icon).
  double tintAt(double v) {
    if (idle || v >= 1) return 0;
    final ms = _ms(v);
    if (reduce) {
      return ms < 100
          ? tintFrom + (1 - tintFrom) * _seg(ms, 0, 100)
          : 1 - Curves.easeOut.transform(_seg(ms, 100, 300));
    }
    const peakAt = 160.0;
    if (ms <= peakAt) {
      final t = Curves.easeOut.transform(_seg(ms, 40, peakAt));
      return tintFrom + (1 - tintFrom) * t;
    }
    return 1 -
        Curves.easeInOut.transform(
          _seg(ms, peakAt, duration.inMilliseconds.toDouble()),
        );
  }

  /// Ring progress 0..1, or `null` when no ring shows.
  double? ringAt(double v) {
    if (idle || reduce) return null;
    final life = _ms(v) + (ring ? 0 : ringOffset.inMilliseconds);
    if (!ring && ringOffset == Duration.zero) return null;
    final t = life / _Motion.ring.inMilliseconds;
    return t >= 1 ? null : t;
  }

  /// Badge scale when it appears from an empty cart, else 1.
  double badgeInAt(double v) {
    if (idle || reduce || (fromCount ?? 0) > 0 || v >= 1) return 1;
    final t = _seg(_ms(v), 60, 420);
    return _Motion.settle.transform(t).clamp(0.0, 1.2);
  }

  /// Roll / cross-fade progress from [fromCount] to [toCount] (1 = done).
  double rollAt(double v) {
    if (idle || fromCount == toCount || (fromCount ?? 0) == 0 || v >= 1) {
      return 1;
    }
    final ms = _ms(v);
    return reduce
        ? _seg(ms, 0, 200)
        : Curves.easeOutCubic.transform(_seg(ms, 80, 380));
  }
}

/// One frame of the icon: ring behind, disc, tilted / scaled bag, badge.
class _Frame extends StatelessWidget {
  const _Frame({
    required this.discOpacity,
    required this.count,
    required this.fromCount,
    required this.scale,
    required this.tilt,
    required this.tint,
    required this.ring,
    required this.badgeIn,
    required this.roll,
    required this.crossFade,
    required this.onTap,
  });

  final double discOpacity;
  final int count;
  final int? fromCount;
  final double scale;
  final double tilt;
  final double tint;
  final double? ring;
  final double badgeIn;
  final double roll;
  final bool crossFade;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    final rest = context.fieldFill.withValues(
      alpha: context.fieldFill.a * discOpacity,
    );
    // Warm, not loud: a light yellow wash over the disc.
    final warm = Color.lerp(
      rest,
      AppColors.accent.withValues(alpha: dark ? 0.35 : 0.45),
      tint * discOpacity,
    )!;
    // In the translucent bar there is no disc: the bag itself warms up.
    final iconWarm = dark ? AppColors.accent : AppColors.accentDeep;
    final iconColor = Color.lerp(
      context.textMain,
      iconWarm,
      tint * (1 - discOpacity),
    )!;

    return SizedBox(
      width: CartIconButton.size,
      height: CartIconButton.size,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          if (ring != null)
            // Painted outside the disc without taking layout space.
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(painter: _RingPainter(progress: ring!)),
              ),
            ),
          Material(
            color: warm,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onTap,
              child: SizedBox(
                width: CartIconButton.size,
                height: CartIconButton.size,
                child: Center(
                  child: Transform.rotate(
                    angle: tilt,
                    // Pivot low, like a bag held by its handles.
                    alignment: const Alignment(0, 0.6),
                    child: Transform.scale(
                      scale: scale,
                      child: Icon(
                        Icons.shopping_bag_outlined,
                        color: iconColor,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (count > 0)
            PositionedDirectional(
              top: 4,
              end: 2,
              child: IgnorePointer(
                child: Transform.scale(
                  scale: badgeIn,
                  child: _Badge(
                    count: count,
                    fromCount: fromCount,
                    roll: roll,
                    crossFade: crossFade,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Yellow pill with the count (ink text, ring in the page colour). The
/// number rolls: the old one slides up and fades, the new one rises from
/// below.
class _Badge extends StatelessWidget {
  const _Badge({
    required this.count,
    required this.fromCount,
    required this.roll,
    required this.crossFade,
  });

  final int count;
  final int? fromCount;
  final double roll;
  final bool crossFade;

  static const double height = 18;

  static String _label(int n) => n > 99 ? '99+' : '$n';

  @override
  Widget build(BuildContext context) {
    final style = AppTextStyles.caption.copyWith(
      color: AppColors.ink,
      fontWeight: FontWeight.w800,
      fontSize: 10,
      height: 1.2,
    );
    Widget number(String label) => Text(
      label,
      // Western digits and "99+" read left to right in every locale.
      textDirection: TextDirection.ltr,
      maxLines: 1,
      textScaler: TextScaler.noScaling,
      style: style,
    );

    final rolling = roll < 1 && fromCount != null && fromCount != count;
    final Widget content;
    if (!rolling) {
      content = number(_label(count));
    } else if (crossFade) {
      content = Stack(
        alignment: Alignment.center,
        children: [
          Opacity(opacity: 1 - roll, child: number(_label(fromCount!))),
          Opacity(opacity: roll, child: number(_label(count))),
        ],
      );
    } else {
      // A count going down (rare here) rolls the other way.
      final dir = count > fromCount! ? 1.0 : -1.0;
      content = ClipRect(
        child: Stack(
          alignment: Alignment.center,
          children: [
            Transform.translate(
              offset: Offset(0, -dir * height * 0.8 * roll),
              child: Opacity(
                opacity: (1 - roll * 1.6).clamp(0.0, 1.0),
                child: number(_label(fromCount!)),
              ),
            ),
            Transform.translate(
              offset: Offset(0, dir * height * 0.8 * (1 - roll)),
              child: Opacity(
                opacity: roll.clamp(0.0, 1.0),
                child: number(_label(count)),
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      constraints: const BoxConstraints(minWidth: height),
      padding: const EdgeInsets.symmetric(horizontal: 5),
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.accent,
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: context.pageBackground, width: 1.5),
      ),
      child: content,
    );
  }
}

/// One soft yellow ring leaving the disc: radius ×1 → ×1.8, 35 % → 0 alpha.
class _RingPainter extends CustomPainter {
  _RingPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final t = Curves.easeOutCubic.transform(progress.clamp(0.0, 1.0));
    final radius = size.shortestSide / 2 * (1 + 0.8 * t);
    final alpha = 0.35 * (1 - Curves.easeOut.transform(progress));
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5 * (1 - 0.5 * t)
      ..color = AppColors.accent.withValues(alpha: alpha);
    canvas.drawCircle(size.center(Offset.zero), radius, paint);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.progress != progress;
}
