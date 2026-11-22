import 'package:flutter/foundation.dart';

/// Counts shown on bottom tabs, by tab path (e.g. the livreur's deliveries
/// left). A screen sets its count when it loads; 0 hides the badge.
class TabBadges {
  TabBadges._();

  static final _counts = <String, ValueNotifier<int>>{};

  static ValueNotifier<int> of(String path) =>
      _counts.putIfAbsent(path, () => ValueNotifier<int>(0));

  /// Forgets every count (sign-out, tests).
  static void reset() {
    for (final n in _counts.values) {
      n.value = 0;
    }
  }
}
