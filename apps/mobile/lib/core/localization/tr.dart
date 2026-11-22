import 'package:flutter/widgets.dart';

import 'app_localizations.dart';

extension TranslateContext on BuildContext {
  /// Looks [key] up in the active locale file (nested keys use dots, e.g.
  /// `jb.cart.title`). Falls back to the key itself so a missing string is
  /// visible instead of blank.
  String tr(String key, {Map<String, Object>? args}) {
    var value = AppLocalizations.of(this)?.translate(key) ?? key;
    args?.forEach((name, arg) => value = value.replaceAll('{$name}', '$arg'));
    return value;
  }
}
