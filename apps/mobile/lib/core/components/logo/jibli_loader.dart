import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../localization/tr.dart';
import 'jibli_logo.dart';
import 'jibli_logo_path.dart';

/// Branded loading indicator: the Jibli parachute drifting down — it sways
/// and bobs over a soft ground shadow while a yellow band sweeps up through
/// the mark.
///
/// Built to stay smooth on low-end phones:
/// * one [AnimationController], wired to the painter as its `repaint`
///   listenable — frames repaint the canvas only, nothing is rebuilt;
/// * the logo is the prebuilt [JibliLogoPath.shape] moved by canvas
///   transforms — no path, shader or object is allocated per frame;
/// * isolated in a [RepaintBoundary]; the ticker pauses off-screen
///   ([TickerMode]) and is never started when the OS asks for reduced motion.
class JibliLoader extends StatefulWidget {
  const JibliLoader({
    super.key,
    this.size = 64,
    this.color,
    this.trackColor,
    this.shadow = true,
  });

  final double size;

  /// Sweep color; brand yellow by default.
  final Color? color;

  /// The unfilled mark; a faint tint of the text color by default.
  final Color? trackColor;

  /// Ground shadow under the mark (off inside buttons).
  final bool shadow;

  @override
  State<JibliLoader> createState() => _JibliLoaderState();
}

class _JibliLoaderState extends State<JibliLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller
        ..stop()
        ..value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return Semantics(
      label: context.tr('loading'),
      child: RepaintBoundary(
        child: CustomPaint(
          size: Size.square(widget.size),
          painter: _LoaderPainter(
            progress: _controller,
            color: widget.color ?? JibliLogo.yellow,
            track: widget.trackColor ?? onSurface.withValues(alpha: 0.08),
            shadow: widget.shadow ? onSurface.withValues(alpha: 0.10) : null,
          ),
        ),
      ),
    );
  }
}

class _LoaderPainter extends CustomPainter {
  _LoaderPainter({
    required this.progress,
    required Color color,
    required Color track,
    required this.shadow,
  }) : _fill = Paint()..color = color,
       _track = Paint()..color = track,
       _shadow = Paint(),
       super(repaint: progress);

  final Animation<double> progress;
  final Color? shadow;
  final Paint _fill;
  final Paint _track;
  final Paint _shadow;

  static const double _vb = JibliLogoPath.viewBox;

  /// Vertical extent of the mark inside the 680 viewBox.
  static const double _top = 31;
  static const double _bottom = 608;

  /// Canopy center: the parcel swings under it like a real parachute.
  static const Offset _pivot = Offset(340, 200);

  static const double _sway = 0.07; // radians, ≈ 4°
  static const double _bob = 18; // viewBox units

  @override
  void paint(Canvas canvas, Size size) {
    final t = progress.value;
    final wave = math.sin(t * 2 * math.pi);
    final lift = (math.cos(t * 2 * math.pi) + 1) / 2; // 0 low … 1 high

    canvas.save();
    canvas.scale(size.width / _vb);

    // Ground shadow: tighter and darker as the mark comes down.
    if (shadow != null) {
      _shadow.color = shadow!.withValues(alpha: shadow!.a * (1 - lift * 0.5));
      final w = _vb * (0.42 - lift * 0.10);
      canvas.drawOval(
        Rect.fromCenter(center: const Offset(340, 650), width: w, height: 22),
        _shadow,
      );
    }

    canvas.translate(0, -_bob * lift);
    canvas.translate(_pivot.dx, _pivot.dy);
    canvas.rotate(_sway * wave);
    canvas.translate(-_pivot.dx, -_pivot.dy);

    final shape = JibliLogoPath.shape;
    canvas.drawPath(shape, _track);

    // Yellow band rising through the mark: its top leads, its bottom
    // follows, so the loop starts and ends empty with no jump.
    final head = Curves.easeInOut.transform((t / 0.6).clamp(0.0, 1.0));
    final tail = Curves.easeInOut.transform(((t - 0.4) / 0.6).clamp(0.0, 1.0));
    if (head > tail) {
      const h = _bottom - _top;
      canvas.save();
      canvas.clipRect(
        Rect.fromLTRB(0, _bottom - head * h, _vb, _bottom - tail * h),
      );
      canvas.drawPath(shape, _fill);
      canvas.restore();
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(_LoaderPainter old) =>
      old.progress != progress ||
      old._fill.color != _fill.color ||
      old._track.color != _track.color ||
      old.shadow != shadow;
}

/// Image slot placeholder: the faint Jibli mark breathing in and out.
/// The mark is painted once; the pulse is a compositor-only opacity change,
/// so a grid full of loading images stays cheap.
class JibliImagePlaceholder extends StatefulWidget {
  const JibliImagePlaceholder({super.key, required this.background});

  final Color background;

  @override
  State<JibliImagePlaceholder> createState() => _JibliImagePlaceholderState();
}

class _JibliImagePlaceholderState extends State<JibliImagePlaceholder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
    lowerBound: 0.35,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller
        ..stop()
        ..value = 0.7;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mark = Theme.of(
      context,
    ).colorScheme.onSurface.withValues(alpha: 0.10);
    return ColoredBox(
      color: widget.background,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final side = constraints.biggest.shortestSide;
          final size = (side.isFinite ? side * 0.38 : 40.0).clamp(16.0, 72.0);
          return Center(
            child: FadeTransition(
              opacity: _controller,
              child: RepaintBoundary(
                child: CustomPaint(
                  size: Size.square(size),
                  painter: _MarkPainter(mark),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(Color color) : _paint = Paint()..color = color;

  final Paint _paint;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / JibliLogoPath.viewBox);
    canvas.drawPath(JibliLogoPath.shape, _paint);
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old._paint.color != _paint.color;
}
