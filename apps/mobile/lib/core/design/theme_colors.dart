import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Theme-aware colour shortcuts so screens never pick white / black by hand.
extension AppThemeContext on BuildContext {
  bool get isDarkMode => Theme.of(this).brightness == Brightness.dark;

  /// Main text and icon colour on the page background.
  Color get textMain => Theme.of(this).colorScheme.onSurface;

  /// Secondary text (descriptions, hints).
  Color get textMuted =>
      isDarkMode ? AppColors.darkTextSecondary : AppColors.textSecondary;

  /// Placeholder / disabled text and icons.
  Color get textFaint => isDarkMode ? Colors.white38 : AppColors.textTertiary;

  /// Fill of input boxes and small controls.
  Color get fieldFill => isDarkMode ? AppColors.darkSurface : AppColors.surface;

  /// Border of input boxes and small controls.
  Color get fieldBorder =>
      isDarkMode ? AppColors.darkDivider : AppColors.divider;

  /// Page background.
  Color get pageBackground => Theme.of(this).scaffoldBackgroundColor;
}
