import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Premium card press: scales to 0.98 while held, light haptic on tap.
/// Shared by the store card and the dish card.
class PressableCard extends StatefulWidget {
  const PressableCard({
    super.key,
    required this.child,
    required this.onTap,
    required this.semanticLabel,
    this.excludeSemantics = true,
  });

  final Widget child;
  final VoidCallback onTap;
  final String semanticLabel;

  /// `false` keeps the children's own semantics (buttons inside the card).
  final bool excludeSemantics;

  @override
  State<PressableCard> createState() => _PressableCardState();
}

class _PressableCardState extends State<PressableCard> {
  bool _pressed = false;

  void _set(bool value) {
    if (_pressed != value) setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return Semantics(
      button: true,
      label: widget.semanticLabel,
      excludeSemantics: widget.excludeSemantics,
      onTap: widget.onTap,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _set(true),
        onTapUp: (_) => _set(false),
        onTapCancel: () => _set(false),
        onTap: () {
          HapticFeedback.lightImpact();
          widget.onTap();
        },
        child: AnimatedScale(
          scale: _pressed && !reduce ? 0.98 : 1,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
          child: widget.child,
        ),
      ),
    );
  }
}
