import 'package:flutter/material.dart';

import '../localization/tr.dart';

/// `1250` → `1 250 DA` (localized currency suffix, thin grouping).
String formatDzd(BuildContext context, num amount) {
  final digits = amount.round().abs().toString();
  final grouped = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) grouped.write(' ');
    grouped.write(digits[i]);
  }
  final sign = amount < 0 ? '-' : '';
  return '$sign$grouped ${context.tr('da')}';
}

/// `2` → `2`, `1.5` → `1.5` (no trailing zeros), plus the localized unit.
String formatQty(BuildContext context, num qty, String unit) {
  final text = qty == qty.roundToDouble()
      ? qty.toInt().toString()
      : qty.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
  return unit == 'piece' ? text : '$text ${context.tr('jb.unit.$unit')}';
}

/// Localized "Oct 16, 2026 · 14:05" in the device's time zone.
String formatDateTime(BuildContext context, DateTime value) {
  final local = value.toLocal();
  final material = MaterialLocalizations.of(context);
  final time = material.formatTimeOfDay(
    TimeOfDay.fromDateTime(local),
    alwaysUse24HourFormat: true,
  );
  return '${material.formatMediumDate(local)} · $time';
}
