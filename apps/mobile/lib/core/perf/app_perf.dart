import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// The one place where the app trades a visual effect for frame time.
///
/// Platform checks for performance go through here (never scattered
/// `Platform.isAndroid`), so a decision can be changed, measured and tested
/// in one spot. See `integration_test/home_feed_scroll_perf_test.dart`.
abstract final class AppPerf {
  /// Forces [useBlur] in tests (`null` = decide from the platform).
  @visibleForTesting
  static bool? debugUseBlurOverride;

  /// Whether pinned surfaces over scrolling content (the home header) may
  /// use a live `BackdropFilter` blur.
  ///
  /// A full-width blur pinned over a scrolling list is re-blurred on every
  /// frame on the raster thread. iPhones (and Macs) absorb it; mid-range
  /// Android GPUs do not, so Android gets a near-opaque surface of the same
  /// colour instead. High contrast also drops it: a solid surface reads
  /// better.
  static bool useBlur(BuildContext context) {
    if (debugUseBlurOverride case final forced?) return forced;
    if (MediaQuery.highContrastOf(context)) return false;
    return switch (defaultTargetPlatform) {
      TargetPlatform.iOS || TargetPlatform.macOS => true,
      _ => false,
    };
  }
}
