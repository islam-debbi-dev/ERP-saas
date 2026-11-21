import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';

import '../../../../core/components/logo/jibli_logo_path.dart';
import '../../../../core/design/design.dart';

/// Colors of the scene for the current theme.
class SceneColors {
  const SceneColors({
    required this.sky,
    required this.ink,
    required this.chip,
    required this.cloud,
    required this.shadow,
  });

  factory SceneColors.of(BuildContext context) => context.isDarkMode
      ? SceneColors(
          sky: AppColors.darkBackground,
          ink: AppColors.yellow,
          chip: AppColors.darkElevated,
          cloud: Colors.white.withValues(alpha: 0.05),
          shadow: Colors.black.withValues(alpha: 0.5),
        )
      : SceneColors(
          sky: AppColors.yellow,
          ink: AppColors.ink,
          chip: AppColors.white,
          cloud: Colors.white.withValues(alpha: 0.5),
          shadow: AppColors.ink.withValues(alpha: 0.10),
        );

  final Color sky;
  final Color ink;
  final Color chip;
  final Color cloud;
  final Color shadow;
}

/// Background of the drop: clouds rising past as the parachute falls
/// ([drop] 0 → 1 across the pages), the current page's icons popping in
/// from the swipe side, and the ground shadow growing as it nears.
///
/// Everything here is position-driven by [page] / [clock]; it rebuilds a
/// handful of plain boxes per frame and never repaints the logo.
class DropBackdrop extends StatelessWidget {
  const DropBackdrop({
    super.key,
    required this.page,
    required this.clock,
    required this.icons,
    required this.colors,
  });

  final double page;

  /// Idle 0 → 1 loop for bobbing and drifting.
  final double clock;
  final List<List<IconData>> icons;
  final SceneColors colors;

  static const _clouds = [
    // x, y (fractions), width, speed
    (0.10, 0.18, 120.0, 1.0),
    (0.72, 0.08, 90.0, 0.6),
    (0.62, 0.55, 140.0, 1.3),
    (0.04, 0.78, 100.0, 0.8),
  ];

  static const _spots = [
    Offset(0.14, 0.20),
    Offset(0.86, 0.36),
    Offset(0.17, 0.62),
  ];
  static const _sizes = [58.0, 68.0, 52.0];

  @override
  Widget build(BuildContext context) {
    final rtl = Directionality.of(context) == TextDirection.rtl;
    return LayoutBuilder(
      builder: (context, box) {
        final w = box.maxWidth;
        final h = box.maxHeight;
        final drop = page / (icons.length - 1);
        final wave = 2 * math.pi * clock;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            // Clouds scroll up with the page (we are falling) and drift.
            for (final (x, y, cw, speed) in _clouds)
              Positioned(
                left: w * x + math.sin(wave + speed * 3) * 8,
                top: _wrap(h * y - page * h * 0.35 * speed, -60, h),
                child: _Cloud(width: cw, color: colors.cloud),
              ),
            // Ground shadow.
            Positioned(
              left: 0,
              right: 0,
              bottom: h * 0.04,
              child: Center(
                child: Container(
                  width: w * (0.22 + drop * 0.22),
                  height: 16,
                  decoration: BoxDecoration(
                    color: colors.shadow.withValues(
                      alpha: colors.shadow.a * (0.5 + drop * 0.8),
                    ),
                    borderRadius: const BorderRadius.all(
                      Radius.elliptical(200, 16),
                    ),
                  ),
                ),
              ),
            ),
            for (var i = 0; i < icons.length; i++)
              ..._chips(i, w, h, wave, rtl),
          ],
        );
      },
    );
  }

  List<Widget> _chips(int i, double w, double h, double wave, bool rtl) {
    final visible = (1 - (page - i).abs()).clamp(0.0, 1.0);
    if (visible == 0) return const [];
    final shift = (i - page) * 90 * (rtl ? -1 : 1);
    return [
      for (var k = 0; k < icons[i].length; k++)
        Positioned(
          left: w * _spots[k].dx - _sizes[k] / 2 + shift * (1 + k * 0.5),
          top: h * _spots[k].dy - _sizes[k] / 2 + math.sin(wave + k * 2) * 6,
          child: Opacity(
            opacity: visible,
            child: Transform.scale(
              // Pops in with a small overshoot, staggered per chip.
              scale: Curves.easeOutBack.transform(
                ((visible - k * 0.12) / (1 - k * 0.12)).clamp(0.0, 1.0),
              ),
              child: Container(
                width: _sizes[k],
                height: _sizes[k],
                decoration: BoxDecoration(
                  color: colors.chip,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.ink.withValues(alpha: 0.08),
                      blurRadius: 12,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Icon(
                  icons[i][k],
                  color: colors.ink,
                  size: _sizes[k] * 0.48,
                ),
              ),
            ),
          ),
        ),
    ];
  }

  /// Keeps a cloud cycling through the sky instead of leaving it for good.
  static double _wrap(double y, double min, double max) {
    final span = max - min;
    return ((y - min) % span + span) % span + min;
  }
}

class _Cloud extends StatelessWidget {
  const _Cloud({required this.width, required this.color});

  final double width;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final h = width * 0.32;
    return SizedBox(
      width: width,
      height: h * 1.5,
      child: Stack(
        children: [
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              height: h,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(h),
              ),
            ),
          ),
          Positioned(
            left: width * 0.22,
            bottom: h * 0.4,
            child: Container(
              width: h * 1.1,
              height: h * 1.1,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
          ),
        ],
      ),
    );
  }
}

/// The Jibli parachute, swaying under its canopy. Grab it and it follows
/// your finger, tilting with the pull; let go and it springs home with a
/// wobble. A tap makes it hop. [onHold] reports grabs so the story pauses.
class GrabbableParachute extends StatefulWidget {
  const GrabbableParachute({
    super.key,
    required this.size,
    required this.color,
    required this.sway,
    required this.onHold,
  });

  final double size;
  final Color color;

  /// Idle sway angle in radians.
  final double sway;
  final ValueChanged<bool> onHold;

  @override
  State<GrabbableParachute> createState() => _GrabbableParachuteState();
}

class _GrabbableParachuteState extends State<GrabbableParachute>
    with SingleTickerProviderStateMixin {
  late final AnimationController _spring = AnimationController.unbounded(
    vsync: this,
  )..addListener(() => setState(() => _offset = _from * _spring.value));

  static const _wobble = SpringDescription(mass: 1, stiffness: 170, damping: 9);

  Offset _offset = Offset.zero;
  Offset _from = Offset.zero;
  double _travelled = 0;

  void _down(PointerDownEvent _) {
    _spring.stop();
    _travelled = 0;
    widget.onHold(true);
  }

  void _move(PointerMoveEvent e) {
    _travelled += e.delta.distance;
    // Rubber band: the further you pull, the harder it resists.
    final next = _offset + e.delta;
    final limit = widget.size * 0.6;
    setState(
      () => _offset = Offset(
        limit * _tanh(next.dx / limit),
        limit * _tanh(next.dy / limit),
      ),
    );
  }

  void _up(PointerEvent _) {
    widget.onHold(false);
    if (_travelled < 8) {
      // Tap: hop.
      HapticFeedback.lightImpact();
      _release(Offset(0, -widget.size * 0.18));
    } else {
      _release(_offset);
    }
  }

  void _release(Offset from) {
    _from = from;
    _spring.animateWith(SpringSimulation(_wobble, 1, 0, 0));
  }

  @override
  void dispose() {
    _spring.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tilt = (_offset.dx / widget.size) * 0.6 + widget.sway;
    return Listener(
      onPointerDown: _down,
      onPointerMove: _move,
      onPointerUp: _up,
      onPointerCancel: _up,
      child: Transform.translate(
        offset: _offset,
        child: Transform.rotate(
          angle: tilt,
          // Pivot on the canopy center (y ≈ 200 of 680).
          alignment: const Alignment(0, -0.41),
          child: RepaintBoundary(
            child: SizedBox.square(
              dimension: widget.size,
              child: CustomPaint(painter: MarkPainter(widget.color)),
            ),
          ),
        ),
      ),
    );
  }
}

double _tanh(double x) {
  final e = math.exp(2 * x.clamp(-10.0, 10.0));
  return (e - 1) / (e + 1);
}

/// The Jibli mark as one flat shape.
class MarkPainter extends CustomPainter {
  MarkPainter(Color color) : _paint = Paint()..color = color;

  final Paint _paint;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / JibliLogoPath.viewBox);
    canvas.drawPath(JibliLogoPath.shape, _paint);
  }

  @override
  bool shouldRepaint(MarkPainter old) => old._paint.color != _paint.color;
}
