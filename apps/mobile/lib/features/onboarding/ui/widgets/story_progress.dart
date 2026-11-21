import 'package:flutter/material.dart';

/// Story-style segments: finished pages full, the current one filling with
/// [progress], the rest empty. Repaints only itself as the timer runs.
class StoryProgress extends StatelessWidget {
  const StoryProgress({
    super.key,
    required this.count,
    required this.index,
    required this.progress,
    required this.color,
  });

  final int count;
  final int index;
  final Animation<double> progress;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: SizedBox(
        height: 4,
        child: CustomPaint(
          painter: _SegmentsPainter(
            count: count,
            index: index,
            progress: progress,
            color: color,
            rtl: Directionality.of(context) == TextDirection.rtl,
          ),
        ),
      ),
    );
  }
}

class _SegmentsPainter extends CustomPainter {
  _SegmentsPainter({
    required this.count,
    required this.index,
    required this.progress,
    required this.color,
    required this.rtl,
  }) : _track = Paint()..color = color.withValues(alpha: 0.2),
       _fill = Paint()..color = color,
       super(repaint: progress);

  final int count;
  final int index;
  final Animation<double> progress;
  final Color color;
  final bool rtl;
  final Paint _track;
  final Paint _fill;

  static const double _gap = 6;

  @override
  void paint(Canvas canvas, Size size) {
    final w = (size.width - _gap * (count - 1)) / count;
    final radius = Radius.circular(size.height / 2);
    for (var i = 0; i < count; i++) {
      // Segment order follows the reading direction.
      final slot = rtl ? count - 1 - i : i;
      final left = slot * (w + _gap);
      final full = RRect.fromLTRBR(left, 0, left + w, size.height, radius);
      canvas.drawRRect(full, _track);
      final f = i < index ? 1.0 : (i == index ? progress.value : 0.0);
      if (f <= 0) continue;
      final fw = w * f;
      canvas.drawRRect(
        rtl
            ? RRect.fromLTRBR(left + w - fw, 0, left + w, size.height, radius)
            : RRect.fromLTRBR(left, 0, left + fw, size.height, radius),
        _fill,
      );
    }
  }

  @override
  bool shouldRepaint(_SegmentsPainter old) =>
      old.index != index ||
      old.count != count ||
      old.color != color ||
      old.rtl != rtl ||
      old.progress != progress;
}
