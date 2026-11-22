import 'package:flutter/material.dart';

/// Width breakpoints (logical pixels).
class Breakpoints {
  Breakpoints._();

  static const double tablet = 600;
  static const double large = 1024;
}

enum ScreenSize { phone, tablet, large }

/// Small helper to adapt layouts instead of just stretching them.
class Responsive {
  Responsive._();

  static ScreenSize of(BuildContext context) =>
      fromWidth(MediaQuery.sizeOf(context).width);

  static ScreenSize fromWidth(double width) {
    if (width >= Breakpoints.large) return ScreenSize.large;
    if (width >= Breakpoints.tablet) return ScreenSize.tablet;
    return ScreenSize.phone;
  }

  static bool isPhone(BuildContext context) => of(context) == ScreenSize.phone;
  static bool isTablet(BuildContext context) => of(context) != ScreenSize.phone;

  /// True on tablets (shortest side >= 600), whatever the orientation.
  static bool isTabletDevice(BuildContext context) =>
      MediaQuery.sizeOf(context).shortestSide >= Breakpoints.tablet;

  /// How many columns a product / card grid should use for the given width.
  static int gridColumns(double width, {int phone = 2}) {
    if (width >= Breakpoints.large) return phone + 3;
    if (width >= Breakpoints.tablet) return phone + 1;
    return phone;
  }

  /// Widest area content is allowed to use before it is centered.
  static double maxContentWidth(BuildContext context) {
    switch (of(context)) {
      case ScreenSize.phone:
        return double.infinity;
      case ScreenSize.tablet:
        return 720;
      case ScreenSize.large:
        return 840;
    }
  }
}

/// Centers [child] and caps its width on tablets / large screens.
class ResponsiveCenter extends StatelessWidget {
  const ResponsiveCenter({super.key, required this.child, this.maxWidth});

  final Widget child;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    final double limit = maxWidth ?? Responsive.maxContentWidth(context);
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: limit),
        child: child,
      ),
    );
  }
}
