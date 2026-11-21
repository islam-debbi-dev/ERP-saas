import 'package:flutter/material.dart';

import 'logo/jibli_logo.dart';

/// Animated brand mark used on the auth screens: the Dart-drawn
/// [JibliLogo] (outline trace → fill pop → shading, then a gentle idle
/// float). Tap to replay.
class AnimatedBrandLogo extends StatelessWidget {
  const AnimatedBrandLogo({super.key, this.size = 200.0, this.duration});

  final double size;
  final Duration? duration;

  @override
  Widget build(BuildContext context) {
    return JibliLogo(
      size: size,
      duration: duration ?? const Duration(milliseconds: 1600),
    );
  }
}
