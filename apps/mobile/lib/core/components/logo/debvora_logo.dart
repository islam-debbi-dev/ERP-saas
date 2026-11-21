import 'package:flutter/material.dart';

import '../../config/app_env.dart';
import '../../theme/app_theme.dart';

/// Placeholder brand mark until the owner sends the Debvora logo: a rounded
/// badge with the first letter, and the app name as a wordmark. Colours come
/// from the env tokens only ([AppColors.primaryColor] / [AppColors.secondaryColor]),
/// so the final colours and logo are a drop-in change.
class DebvoraBadge extends StatelessWidget {
  const DebvoraBadge({super.key, this.size = 64});

  final double size;

  @override
  Widget build(BuildContext context) {
    final name = AppEnv.appName;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.primaryColor,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      child: Text(
        name.isEmpty ? 'D' : name.characters.first.toUpperCase(),
        style: TextStyle(
          fontFamily: 'Almarai',
          fontWeight: FontWeight.w800,
          fontSize: size * 0.56,
          height: 1,
          color: AppColors.onPrimary,
        ),
      ),
    );
  }
}

/// Badge + app name, stacked. [size] is the badge size; the name scales with it.
class DebvoraWordmark extends StatelessWidget {
  const DebvoraWordmark({super.key, this.size = 96});

  final double size;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return Semantics(
      label: AppEnv.appName,
      child: ExcludeSemantics(
        // Never overflows a small box: scales the whole mark down to fit.
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DebvoraBadge(size: size),
              SizedBox(height: size * 0.16),
              Text(
                AppEnv.appName,
                textDirection: TextDirection.ltr,
                style: TextStyle(
                  fontFamily: 'Almarai',
                  fontWeight: FontWeight.w800,
                  fontSize: size * 0.3,
                  letterSpacing: 0.5,
                  color: onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The wordmark with a short fade + scale entrance (auth and splash screens).
/// Skipped when the OS asks for reduced motion.
class AnimatedBrandLogo extends StatelessWidget {
  const AnimatedBrandLogo({
    super.key,
    this.size = 96,
    this.duration = const Duration(milliseconds: 700),
  });

  final double size;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    final mark = DebvoraWordmark(size: size);
    if (MediaQuery.disableAnimationsOf(context)) return mark;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: duration,
      curve: Curves.easeOutBack,
      builder: (context, t, child) => Opacity(
        opacity: t.clamp(0.0, 1.0),
        child: Transform.scale(scale: 0.85 + 0.15 * t, child: child),
      ),
      child: mark,
    );
  }
}

/// Loading indicator: a spinner ring around the badge letter. Same API as the
/// previous loader, so call sites stay unchanged.
class BrandLoader extends StatelessWidget {
  const BrandLoader({
    super.key,
    this.size = 64,
    this.color,
    this.trackColor,
    this.shadow = true,
  });

  final double size;

  /// Ring colour; the brand accent by default.
  final Color? color;

  /// The unfilled ring; a faint tint of the text colour by default.
  final Color? trackColor;

  /// Soft ground shadow under the loader (off inside buttons).
  final bool shadow;

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    final ring = color ?? AppColors.primaryColor;
    final still = MediaQuery.disableAnimationsOf(context);
    return RepaintBoundary(
      child: SizedBox.square(
        dimension: size,
        child: DecoratedBox(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: shadow
                ? [
                    BoxShadow(
                      color: onSurface.withValues(alpha: 0.08),
                      blurRadius: size * 0.2,
                      offset: Offset(0, size * 0.08),
                    ),
                  ]
                : null,
          ),
          child: CircularProgressIndicator(
            value: still ? 0.75 : null,
            strokeWidth: (size * 0.09).clamp(2.0, 6.0),
            color: ring,
            backgroundColor: trackColor ?? onSurface.withValues(alpha: 0.12),
            semanticsLabel: AppEnv.appName,
          ),
        ),
      ),
    );
  }
}

/// Shown while a network image loads or when it fails: a faint image icon
/// pulsing on the field colour. Still when the OS asks for reduced motion.
class ImagePlaceholder extends StatefulWidget {
  const ImagePlaceholder({super.key, required this.background});

  final Color background;

  @override
  State<ImagePlaceholder> createState() => _ImagePlaceholderState();
}

class _ImagePlaceholderState extends State<ImagePlaceholder>
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
              child: Icon(Icons.image_outlined, size: size, color: mark),
            ),
          );
        },
      ),
    );
  }
}
