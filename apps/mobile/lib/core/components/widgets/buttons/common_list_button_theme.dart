import 'package:flutter/material.dart';
import '../../../theme/app_theme.dart';

/// Extension method to get theme-aware list button styling
extension CommonListButtonThemeExtension on BuildContext {
  /// Get theme-aware list button colors
  CommonListButtonThemeColors getListButtonThemeColors() {
    final isDark = Theme.of(this).brightness == Brightness.dark;

    return CommonListButtonThemeColors(
      isDark: isDark,
      normalColor: isDark ? AppColors.darkSurface : AppColors.surface,
      logoutColor: isDark
          ? AppColors.error.withValues(alpha: 0.18)
          : AppColors.errorTint,
      textColor: isDark ? Colors.white : AppColors.ink,
      disabledColor: isDark ? AppColors.darkSurface : AppColors.grouped,
      iconColor: isDark ? AppColors.darkTextSecondary : AppColors.textSecondary,
      dividerColor: isDark ? AppColors.darkDivider : AppColors.divider,
      successColorBg: isDark
          ? AppColors.success.withValues(alpha: 0.18)
          : AppColors.successTint,
      successColorText: AppColors.success,
      failureColorBg: isDark
          ? AppColors.error.withValues(alpha: 0.18)
          : AppColors.errorTint,
      failureColorText: AppColors.error,
    );
  }
}

/// Theme-aware color configuration for list buttons
class CommonListButtonThemeColors {
  final bool isDark;
  final Color normalColor;
  final Color logoutColor;
  final Color textColor;
  final Color disabledColor;
  final Color iconColor;
  final Color dividerColor;
  final Color successColorBg;
  final Color successColorText;
  final Color failureColorBg;
  final Color failureColorText;

  CommonListButtonThemeColors({
    required this.isDark,
    required this.normalColor,
    required this.logoutColor,
    required this.textColor,
    required this.disabledColor,
    required this.iconColor,
    required this.dividerColor,
    required this.successColorBg,
    required this.successColorText,
    required this.failureColorBg,
    required this.failureColorText,
  });
}

/// Helper class for theme-aware text styles in list buttons
class CommonListButtonThemeTextStyle {
  static TextStyle getDefaultTextStyle(
    BuildContext context, {
    FontWeight fontWeight = FontWeight.w500,
    double fontSize = 16,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return TextStyle(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: isDark ? Colors.white : AppColors.ink,
      fontFamily: 'Almarai',
    );
  }

  static TextStyle getSubtitleStyle(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      color: isDark ? AppColors.darkTextSecondary : AppColors.textSecondary,
      fontFamily: 'Almarai',
    );
  }
}
