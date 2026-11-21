import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';

import 'jibli_logo_path.dart';

/// The Jibli mark, drawn in Dart from [JibliLogoPath] and animated:
///
/// 1. the outline traces itself in,
/// 2. the yellow fill pops in with a small overshoot,
/// 3. the soft bottom shading (from the SVG's gradient mask) fades up,
/// 4. then, if [idle] is on, the mark floats gently with a light shine sweep.
///
/// Tap to replay. With [animate] off it renders the finished mark statically.
class JibliLogo extends StatefulWidget {
  const JibliLogo({
    super.key,
    this.size = 120,
    this.animate = true,
    this.idle = true,
    this.duration = const Duration(milliseconds: 1800),
    this.onIntroDone,
  });

  final double size;
  final bool animate;

  /// Keep a subtle float + shine running after the intro.
  final bool idle;
  final Duration duration;
  final VoidCallback? onIntroDone;

  /// Brand colors taken from the SVG.
  static const Color yellow = Color(0xFFFDD322);
  static const Color shade = Color(0xFF2C2C2C);

  @override
  State<JibliLogo> createState() => _JibliLogoState();
}

class _JibliLogoState extends State<JibliLogo> with TickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(
    vsync: this,
    duration: widget.duration,
  );
  late final AnimationController _idle = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3200),
  );

  late final Animation<double> _trace = CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.0, 0.55, curve: Curves.easeInOutCubic),
  );
  late final Animation<double> _fill = CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.40, 0.75, curve: Curves.easeOut),
  );
  late final Animation<double> _pop = CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.40, 0.90, curve: Curves.easeOutBack),
  );
  late final Animation<double> _shade = CurvedAnimation(
    parent: _intro,
    curve: const Interval(0.65, 1.0, curve: Curves.easeOut),
  );

  @override
  void initState() {
    super.initState();
    _intro.addStatusListener((status) {
      if (status != AnimationStatus.completed) return;
      widget.onIntroDone?.call();
      if (widget.idle && mounted) _idle.repeat();
    });
    if (widget.animate) {
      _intro.forward();
    } else {
      _intro.value = 1;
      if (widget.idle) _idle.repeat();
    }
  }

  @override
  void dispose() {
    _intro.dispose();
    _idle.dispose();
    super.dispose();
  }

  void _replay() {
    _idle
      ..stop()
      ..value = 0;
    _intro.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Jibli',
      image: true,
      child: GestureDetector(
        onTap: _replay,
        child: RepaintBoundary(
          child: AnimatedBuilder(
            animation: Listenable.merge([_intro, _idle]),
            builder: (context, _) {
              // Float: a slow sine on the idle loop (0 during the intro).
              final float = math.sin(_idle.value * 2 * math.pi);
              return Transform.translate(
                offset: Offset(0, -widget.size * 0.02 * float),
                child: CustomPaint(
                  size: Size.square(widget.size),
                  painter: _JibliLogoPainter(
                    trace: _trace.value,
                    fill: _fill.value,
                    pop: 0.86 + 0.14 * _pop.value,
                    shade: _shade.value,
                    shine: _idle.isAnimating ? _idle.value : -1,
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _JibliLogoPainter extends CustomPainter {
  _JibliLogoPainter({
    required this.trace,
    required this.fill,
    required this.pop,
    required this.shade,
    required this.shine,
  });

  /// 0 → 1 portion of the outline drawn.
  final double trace;

  /// 0 → 1 opacity of the yellow fill.
  final double fill;

  /// Scale of the mark (overshoots slightly past 1 while popping).
  final double pop;

  /// 0 → 1 strength of the bottom shading.
  final double shade;

  /// Shine sweep position 0 → 1, or < 0 when off.
  final double shine;

  static const double _vb = JibliLogoPath.viewBox;

  @override
  void paint(Canvas canvas, Size size) {
    final path = JibliLogoPath.shape;
    final scale = size.width / _vb;

    canvas.save();
    // Pop around the center of the mark.
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale * pop);
    canvas.translate(-_vb / 2, -_vb / 2);

    // 1. Outline trace (fades out once the fill has taken over).
    if (trace > 0 && fill < 1) {
      final stroke = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 10
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = JibliLogo.yellow.withValues(alpha: 1 - fill * 0.9);
      final traced = Path();
      for (final metric in path.computeMetrics()) {
        traced.addPath(
          metric.extractPath(0, metric.length * trace),
          Offset.zero,
        );
      }
      canvas.drawPath(traced, stroke);
    }

    // 2. Yellow body.
    if (fill > 0) {
      canvas.drawPath(
        path,
        Paint()..color = JibliLogo.yellow.withValues(alpha: fill),
      );
    }

    // 3. Bottom shading — the SVG's #2C2C2C overlay at 50% opacity, masked
    //    by a vertical gradient from transparent to 60%.
    if (shade > 0) {
      final shading = Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            JibliLogo.shade.withValues(alpha: 0),
            JibliLogo.shade.withValues(alpha: 0.30 * shade),
          ],
        ).createShader(const Rect.fromLTWH(0, 0, _vb, _vb));
      canvas.drawPath(path, shading);
    }

    // 4. Idle shine: a soft diagonal band sweeping across, clipped to the mark.
    if (shine >= 0 && shine < 0.45) {
      final t = shine / 0.45;
      final x = lerpDouble(-_vb * 0.6, _vb * 1.2, Curves.easeInOut.transform(t))!;
      canvas.save();
      canvas.clipPath(path);
      final band = Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: 0.35),
            Colors.white.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromLTWH(x, 0, _vb * 0.35, _vb));
      canvas.translate(x + _vb * 0.175, _vb / 2);
      canvas.rotate(math.pi / 9);
      canvas.translate(-(x + _vb * 0.175), -_vb / 2);
      canvas.drawRect(Rect.fromLTWH(x, -_vb * 0.5, _vb * 0.35, _vb * 2), band);
      canvas.restore();
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(_JibliLogoPainter old) =>
      old.trace != trace ||
      old.fill != fill ||
      old.pop != pop ||
      old.shade != shade ||
      old.shine != shine;
}
