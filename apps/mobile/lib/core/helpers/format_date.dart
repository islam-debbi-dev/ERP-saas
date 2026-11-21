import 'package:flutter/material.dart';

import '../localization/app_localizations.dart';

String formatAgeDuration(
  Duration duration,
  AppLocalizations localizations,
  BuildContext context,
) {
  int days = duration.inDays;
  bool isRtl = Directionality.of(context) == TextDirection.rtl;

  String buildString(int value, String unit) {
    if (isRtl) {
      // RTL: "منذ 3 سنوات"
      return "${localizations.translate('ago')} $value$unit";
    } else {
      // LTR: "3 years ago"
      return "$value$unit ${localizations.translate('ago')}";
    }
  }

  if (days >= 365) {
    int years = (days / 365).floor();
    return buildString(years, localizations.translate('short_years'));
  } else if (days >= 30) {
    int months = (days / 30).floor();
    return buildString(months, localizations.translate('short_months'));
  } else if (days >= 1) {
    return buildString(days, localizations.translate('short_days'));
  } else {
    return localizations.translate('just_now');
  }
}
