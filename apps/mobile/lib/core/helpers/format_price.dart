import 'package:flutter/material.dart';

import '../localization/app_localizations.dart';

String formatPrice(BuildContext context, dynamic price) {
  final localizations = AppLocalizations.of(context);
  if (price is String) {
    price = double.tryParse(price) ?? 0;
  }
  // edit this code and return value as float like when value 1234 not make it  1.234 billion not 1.2 billion
  // if (price >= 1000) {
  //   final value = (price / 1000).toStringAsFixed(1);
  //   return '$value ${localizations?.translate("billion") ?? ''}';
  // } else {
  //   final value = price.toStringAsFixed(0);
  //   return '$value ${localizations?.translate("million") ?? ''}';
  // }
  if (price >= 10000000) {
    // Billion
    final value = (price / 10000000);
    return '${value.toStringAsFixed(value.truncateToDouble() == value ? 0 : 1)} ${localizations?.translate("billion") ?? 'billion'}';
  } else if (price >= 10000) {
    // Million
    final value = (price / 10000);
    return '${value.toStringAsFixed(value.truncateToDouble() == value ? 0 : 1)} ${localizations?.translate("million") ?? 'million'}';
  } else {
    // Less than a million
    return '${price.toStringAsFixed(0)} ${localizations?.translate("da") ?? 'DA'}';
  }
}
