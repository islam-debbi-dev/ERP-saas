import 'package:flutter/material.dart';
import '../config/app_env.dart';

/// Brand + neutral tokens (clean white surfaces, ink for actions, an accent).
///
/// Every brand colour comes from [AppEnv] (`APP_PRIMARY_COLOR` /
/// `APP_SECONDARY_COLOR` in the env file or `--dart-define`), so changing the
/// Debvora colours is one env edit:
///  * [primaryColor]   = the brand accent, and its [accentDeep] / [accentTint]
///  * [secondaryColor] = the action colour used for buttons and active states
/// Everything else below is a fixed neutral token. Widgets never write a hex
/// colour: they use these tokens or `Theme.of(context)`.
class AppColors {
  AppColors._();

  /// Brand accent. Maps to `APP_PRIMARY_COLOR` in the env file.
  static Color get primaryColor => AppEnv.primaryColor;

  /// Action colour (buttons, active tab). Maps to `APP_SECONDARY_COLOR`.
  static Color get secondaryColor => AppEnv.secondaryColor;

  /// The accent itself (badges, highlights, active chips).
  static Color get accent => primaryColor;

  /// A deeper shade of the accent (pressed states, borders on the accent).
  static Color get accentDeep =>
      Color.lerp(primaryColor, const Color(0xFF000000), 0.08)!;

  /// A soft tint of the accent (chip and highlight backgrounds).
  static Color get accentTint =>
      Color.lerp(const Color(0xFFFFFFFF), primaryColor, 0.25)!;

  // ── Neutral tokens (constants, safe to use in const contexts) ─────────────
  static const Color ink = Color(0xFF1E1E1E);
  static const Color inkSoft = Color(0xFF3A3A3C);

  static const Color white = Color(0xFFFFFFFF);
  static const Color background = Color(0xFFFFFFFF);
  static const Color surface = Color(0xFFF7F7F7);
  static const Color grouped = Color(0xFFF2F2F7);
  static const Color border = Color(0xFFD1D1D6);
  static const Color divider = Color(0xFFE5E5EA);

  static const Color textPrimary = ink;
  static const Color textSecondary = Color(0xFF6C6C70);
  static const Color textTertiary = Color(0xFF8E8E93);

  static const Color success = Color(0xFF34C759);
  static const Color warning = Color(0xFFFF9500);
  static const Color error = Color(0xFFFF3B30);
  static const Color errorTint = Color(0xFFFFEBEE);
  static const Color successTint = Color(0xFFE8F8EC);
  static const Color info = Color(0xFF0A84FF);

  // Dark mode counterparts.
  static const Color darkBackground = Color(0xFF111111);
  static const Color darkSurface = Color(0xFF1C1C1E);
  static const Color darkElevated = Color(0xFF2C2C2E);
  static const Color darkDivider = Color(0xFF38383A);
  static const Color darkTextSecondary = Color(0xFFAEAEB2);

  /// Deepest page background (privacy / help pages in dark mode).
  static const Color darkDeep = Color(0xFF0D0D0D);

  /// Raised card in dark mode, slightly blue (shimmer cards, dropdowns).
  static const Color darkCard = Color(0xFF171B22);

  // Loading placeholders (shimmer).
  static const Color shimmerBase = Color(0xFFE8E8E8);
  static const Color shimmerBlock = Color(0xFFDDDDDD);
  static const Color shimmerBaseDark = Color(0xFF2A3441);
  static const Color shimmerHighlightDark = Color(0xFF3A4758);
  static const Color shimmerBlockDark = Color(0xFF233041);

  /// Grey veil over an image of something unavailable.
  static const Color desaturate = Color(0x66808080);

  // ── Legacy names kept so existing screens keep compiling ──────────────────
  static const Color threedColor = ink;
  static const Color cardLightColor = surface;
  static const Color cardDarkColor = darkSurface;
  static const Color forthdColor = textTertiary;
  static const Color fifthColor = border;

  /// Light-mode page background.
  static Color get surfaceLight => background;

  /// Dark-mode page background.
  static Color get surfaceDark => darkBackground;

  /// Soft tint of the brand accent (chips, highlights).
  static Color get primaryContainer => accentTint;

  /// Soft tint of the action colour.
  static Color get secondaryContainer => grouped;

  /// Foreground with enough contrast on [primaryColor].
  static Color get onPrimary =>
      primaryColor.computeLuminance() > 0.5 ? Colors.black : Colors.white;

  /// Foreground with enough contrast on [secondaryColor].
  static Color get onSecondary =>
      secondaryColor.computeLuminance() > 0.5 ? Colors.black : Colors.white;
}
