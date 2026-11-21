import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/components/logo/jibli_logo.dart';
import '../../../../core/components/logo/jibli_logo_path.dart';
import '../../../../core/design/design.dart';

/// Pill slider: drag the parcel knob to the far end to confirm. Follows the
/// reading direction (left → right, right → left in Arabic). Letting go
/// early springs back; a tap nudges the knob to show the way. Screen readers
/// get a plain button, since a drag-only control would lock them out.
class SwipeToStart extends StatefulWidget {
  const SwipeToStart({
    super.key,
    required this.label,
    required this.semanticHint,
    required this.onCompleted,
  });

  final String label;
  final String semanticHint;
  final VoidCallback onCompleted;

  @override
  State<SwipeToStart> createState() => SwipeToStartState();
}

class SwipeToStartState extends State<SwipeToStart>
    with SingleTickerProviderStateMixin {
  static const double _height = 64;
  static const double _inset = 6;
  static const double _knob = _height - _inset * 2;

  /// 0 = knob at the start, 1 = at the end.
  late final AnimationController _progress = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 280),
  );
  double _travel = 1;
  bool _done = false;

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  bool get _rtl => Directionality.of(context) == TextDirection.rtl;

  void _onDrag(DragUpdateDetails d) {
    if (_done) return;
    final dx = _rtl ? -d.delta.dx : d.delta.dx;
    _progress.value = (_progress.value + dx / _travel).clamp(0.0, 1.0);
  }

  void _onRelease([DragEndDetails? d]) {
    if (_done) return;
    final velocity = (d?.primaryVelocity ?? 0) * (_rtl ? -1 : 1);
    if (_progress.value > 0.8 || (_progress.value > 0.5 && velocity > 700)) {
      _complete();
    } else {
      _progress.animateBack(0, curve: Curves.easeOutBack);
    }
  }

  Future<void> _complete() async {
    _done = true;
    HapticFeedback.mediumImpact();
    await _progress.animateTo(1, curve: Curves.easeOut);
    if (mounted) widget.onCompleted();
  }

  /// Slides the knob a little way and back to show the gesture.
  Future<void> nudge() async {
    if (_done || _progress.isAnimating) return;
    HapticFeedback.selectionClick();
    await _progress.animateTo(0.22, curve: Curves.easeOut);
    if (mounted && !_done) _progress.animateBack(0, curve: Curves.bounceOut);
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.label,
      hint: widget.semanticHint,
      onTap: _done ? null : _complete,
      excludeSemantics: true,
      child: LayoutBuilder(
        builder: (context, constraints) {
          _travel = constraints.maxWidth - _knob - _inset * 2;
          return Container(
            height: _height,
            decoration: BoxDecoration(
              color: context.isDarkMode
                  ? AppColors.darkElevated
                  : AppColors.ink,
              borderRadius: BorderRadius.circular(_height / 2),
            ),
            child: AnimatedBuilder(
              animation: _progress,
              builder: (context, _) {
                final p = _progress.value;
                final offset = _inset + p * _travel;
                return Stack(
                  children: [
                    // Yellow trail filling behind the knob.
                    PositionedDirectional(
                      start: _inset,
                      top: _inset,
                      bottom: _inset,
                      width: _knob + p * _travel,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: AppColors.yellow.withValues(
                            alpha: 0.18 + p * 0.5,
                          ),
                          borderRadius: BorderRadius.circular(_knob / 2),
                        ),
                      ),
                    ),
                    Positioned.fill(
                      child: Padding(
                        padding: const EdgeInsetsDirectional.only(
                          start: _knob + _inset * 2,
                          end: AppSpacing.lg,
                        ),
                        child: Center(
                          child: Opacity(
                            opacity: (1 - p * 1.6).clamp(0.0, 1.0),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Flexible(
                                  child: Text(
                                    widget.label,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: AppTextStyles.button.copyWith(
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                                Icon(
                                  _rtl
                                      ? Icons.keyboard_double_arrow_left_rounded
                                      : Icons
                                            .keyboard_double_arrow_right_rounded,
                                  color: AppColors.yellow,
                                  size: 22,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    PositionedDirectional(
                      start: offset,
                      top: _inset,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: nudge,
                        onHorizontalDragUpdate: _onDrag,
                        onHorizontalDragEnd: _onRelease,
                        onHorizontalDragCancel: _onRelease,
                        child: _Knob(progress: _rtl ? -p : p),
                      ),
                    ),
                  ],
                );
              },
            ),
          );
        },
      ),
    );
  }
}

/// The parcel: the Jibli mark on a yellow disc, tipping as it slides.
class _Knob extends StatelessWidget {
  const _Knob({required this.progress});

  /// Signed: negative tips the other way in right-to-left layouts.
  final double progress;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: SwipeToStartState._knob,
      height: SwipeToStartState._knob,
      decoration: const BoxDecoration(
        color: JibliLogo.yellow,
        shape: BoxShape.circle,
      ),
      padding: const EdgeInsets.all(10),
      child: Transform.rotate(
        angle: progress * 0.25,
        child: const CustomPaint(painter: _MarkPainter(AppColors.ink)),
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  const _MarkPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / JibliLogoPath.viewBox);
    canvas.drawPath(JibliLogoPath.shape, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.color != color;
}
