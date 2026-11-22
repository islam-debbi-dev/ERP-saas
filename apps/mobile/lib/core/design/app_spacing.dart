import 'package:flutter/material.dart';

/// Spacing scale used everywhere for padding, gaps and margins.
/// Values are logical pixels on a 4pt rhythm.
class AppSpacing {
  AppSpacing._();

  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double huge = 48;

  /// Default horizontal padding of a full-width screen.
  static const double screenH = 20;

  static const EdgeInsets screen = EdgeInsets.symmetric(horizontal: screenH);
  static const EdgeInsets card = EdgeInsets.all(lg);

  /// Minimum touch target recommended by Material / Apple HIG.
  static const double minTouch = 48;

  /// Space a tab's scrolling content keeps at its end so the last row clears
  /// the floating bottom bar.
  static const double navClearance = 130;

  static const SizedBox gapXs = SizedBox(height: xs, width: xs);
  static const SizedBox gapSm = SizedBox(height: sm, width: sm);
  static const SizedBox gapMd = SizedBox(height: md, width: md);
  static const SizedBox gapLg = SizedBox(height: lg, width: lg);
  static const SizedBox gapXl = SizedBox(height: xl, width: xl);
}

/// Corner radii (iOS-like, generous and consistent).
class AppRadius {
  AppRadius._();

  static const double sm = 10;
  static const double md = 14;
  static const double lg = 18;
  static const double xl = 24;
  static const double pill = 999;

  static const BorderRadius smAll = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius mdAll = BorderRadius.all(Radius.circular(md));
  static const BorderRadius lgAll = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius xlAll = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius pillAll = BorderRadius.all(Radius.circular(pill));
}

/// Soft, low-contrast shadows. Kept light so white surfaces stay clean.
class AppShadows {
  AppShadows._();

  static const List<BoxShadow> soft = [
    BoxShadow(color: Color(0x14000000), blurRadius: 18, offset: Offset(0, 6)),
  ];

  static const List<BoxShadow> card = [
    BoxShadow(color: Color(0x0F000000), blurRadius: 12, offset: Offset(0, 4)),
  ];

  static const List<BoxShadow> floating = [
    BoxShadow(color: Color(0x24000000), blurRadius: 28, offset: Offset(0, 10)),
  ];
}
