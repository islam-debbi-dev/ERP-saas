import 'package:flutter/material.dart';

/// Plays a short fade + slide the first time it is built, delayed by
/// [index] × [step] (capped by [maxDelay] so a long list never waits).
/// [from] is a logical offset in pixels: a positive `dx` comes from the end
/// side of the reading direction (right in LTR, left in RTL).
/// With Reduce Motion it only fades, without delay.
class StaggeredEntrance extends StatefulWidget {
  const StaggeredEntrance({
    super.key,
    required this.child,
    this.index = 0,
    this.enabled = true,
    this.from = const Offset(0, 16),
    this.step = const Duration(milliseconds: 40),
    this.maxDelay = const Duration(milliseconds: 160),
    this.duration = const Duration(milliseconds: 220),
  });

  final Widget child;
  final int index;

  /// `false` shows [child] as is (later pages, rebuilds).
  final bool enabled;
  final Offset from;
  final Duration step;
  final Duration maxDelay;
  final Duration duration;

  @override
  State<StaggeredEntrance> createState() => _StaggeredEntranceState();
}

class _StaggeredEntranceState extends State<StaggeredEntrance>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    value: widget.enabled ? 0 : 1,
  );

  /// The delay is the start of an [Interval], so no timer outlives the
  /// widget.
  Animation<double> _curve = const AlwaysStoppedAnimation(1);
  bool _started = false;
  bool _reduceMotion = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (_started || !widget.enabled) return;
    _started = true;
    var delay = _reduceMotion ? Duration.zero : widget.step * widget.index;
    if (delay > widget.maxDelay) delay = widget.maxDelay;
    final total = delay + widget.duration;
    _controller.duration = total;
    _curve = CurvedAnimation(
      parent: _controller,
      curve: Interval(
        delay.inMicroseconds / total.inMicroseconds,
        1,
        curve: Curves.easeOutCubic,
      ),
    );
    _controller.forward().whenComplete(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_controller.isCompleted) return widget.child;
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final from = _reduceMotion
        ? Offset.zero
        : Offset(rtl ? -widget.from.dx : widget.from.dx, widget.from.dy);
    return AnimatedBuilder(
      animation: _curve,
      child: widget.child,
      builder: (context, child) => Opacity(
        opacity: _curve.value,
        child: Transform.translate(
          offset: from * (1 - _curve.value),
          child: child,
        ),
      ),
    );
  }
}
