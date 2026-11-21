import 'package:flutter/material.dart';

import '../localization/app_localizations.dart';

String formatArea(BuildContext context, dynamic value) {
  final localizations = AppLocalizations.of(context);
  final areaUnit = localizations?.translate('sqm') ?? 'm²';
  final isArabic = Localizations.localeOf(context).languageCode == 'ar';

  if (value == null) return '0 $areaUnit';

  if (value is String) {
    if (value.isEmpty) return '0 $areaUnit';
    value = double.tryParse(value) ?? 0;
  }

  double numericValue = 0;
  if (value is int) {
    numericValue = value.toDouble();
  } else if (value is double) {
    numericValue = value;
  } else {
    numericValue = double.tryParse(value.toString()) ?? 0;
  }

  if (numericValue >= 10000) {
    final formatted = (numericValue / 10000).toStringAsFixed(2);
    final unit = localizations?.translate("hectare") ?? 'ha';
    return isArabic ? '$formatted $unit' : '$unit $formatted ';
  } else if (numericValue >= 1000) {
    final formatted = (numericValue / 1000).toStringAsFixed(1);
    final unit = localizations?.translate("thousand_sqm") ?? 'thousand m²';
    return isArabic ? '$formatted $unit' : '$unit $formatted';
  } else {
    return '${numericValue.toStringAsFixed(0)} $areaUnit';
  }
}
