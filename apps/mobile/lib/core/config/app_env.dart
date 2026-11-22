import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart' show Color;
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Environment values. Loaded from `assets/config/env.default` in main, with
/// optional `--dart-define=KEY=...` overrides (CI / local flags).
///
/// Priority for every key: `--dart-define` > env file > fallback below.
/// The template with every key is `apps/mobile/.env.example`.
class AppEnv {
  AppEnv._();

  /// The production API (Vercel). No global prefix: routes are `/auth/login`...
  static const String productionApiUrl = 'https://erp-saas-pi.vercel.app';

  static String _e(String k) {
    // Safe before / without a loaded dotenv (widget tests, a splash that renders
    // before the async load): uninitialized means the fallback applies.
    if (!dotenv.isInitialized) return '';
    return dotenv.env[k]?.trim() ?? '';
  }

  /// `--dart-define` > env file > [fallback].
  static String _str(String fromDefine, String key, String fallback) {
    if (fromDefine.isNotEmpty) return fromDefine;
    final env = _e(key);
    return env.isNotEmpty ? env : fallback;
  }

  static const String _fallbackAppName = 'Debvora';
  static const Color _fallbackPrimaryColor = Color(0xFFFFD83A);
  static const Color _fallbackSecondaryColor = Color(0xFF1E1E1E);

  static const String _apiFromDefine = String.fromEnvironment('API_BASE_URL');
  static const String _dashboardFromDefine = String.fromEnvironment(
    'DASHBOARD_URL',
  );
  static const String _appNameFromDefine = String.fromEnvironment('APP_NAME');
  static const String _primaryColorFromDefine = String.fromEnvironment(
    'APP_PRIMARY_COLOR',
  );
  static const String _secondaryColorFromDefine = String.fromEnvironment(
    'APP_SECONDARY_COLOR',
  );
  static const String _supportEmailFromDefine = String.fromEnvironment(
    'SUPPORT_EMAIL',
  );
  static const String _privacyEmailFromDefine = String.fromEnvironment(
    'PRIVACY_EMAIL',
  );

  // ── Backend ────────────────────────────────────────────────────────────────

  /// Base URL of the ERP API, without a trailing slash.
  static String get apiBaseUrl =>
      _trimSlash(_str(_apiFromDefine, 'API_BASE_URL', productionApiUrl));

  /// The web dashboard. Office roles (owner, manager) are refused in the app
  /// and sent there. Empty when not configured: the link is then hidden.
  static String get dashboardUrl =>
      _trimSlash(_str(_dashboardFromDefine, 'DASHBOARD_URL', ''));

  static String _trimSlash(String url) =>
      url.endsWith('/') ? url.substring(0, url.length - 1) : url;

  // ── Branding ───────────────────────────────────────────────────────────────

  /// In-app name (wordmark, MaterialApp title). The launcher label is native:
  /// see `package_rename_config.yaml` and docs/branding.md.
  static String get appName =>
      _str(_appNameFromDefine, 'APP_NAME', _fallbackAppName);

  /// Contact address shown in the help screen. Hidden when empty.
  static String get supportEmail =>
      _str(_supportEmailFromDefine, 'SUPPORT_EMAIL', '');

  /// Contact address shown in the privacy screen. Hidden when empty.
  static String get privacyEmail =>
      _str(_privacyEmailFromDefine, 'PRIVACY_EMAIL', '');

  static Color get primaryColor => _color(
    'APP_PRIMARY_COLOR',
    _primaryColorFromDefine,
    _fallbackPrimaryColor,
  );

  static Color get secondaryColor => _color(
    'APP_SECONDARY_COLOR',
    _secondaryColorFromDefine,
    _fallbackSecondaryColor,
  );

  static Color _color(String key, String fromDefine, Color fallback) {
    final raw = fromDefine.isNotEmpty ? fromDefine : _e(key);
    if (raw.isEmpty) return fallback;
    return parseHexColor(key, raw, fallback);
  }

  /// Parses `#RRGGBB` or `#AARRGGBB` (the `#` is optional). A malformed value
  /// throws in debug builds (clear message) and falls back in release builds,
  /// so the app still boots.
  static Color parseHexColor(String key, String raw, Color fallback) {
    var hex = raw.trim();
    if (hex.startsWith('#')) hex = hex.substring(1);
    final int? value = int.tryParse(hex, radix: 16);
    if (value != null && hex.length == 6) return Color(0xFF000000 | value);
    if (value != null && hex.length == 8) return Color(value);
    if (kDebugMode) {
      throw StateError(
        'AppEnv: $key must be a hex color like "#1B7F5E" (or "#AARRGGBB"), '
        'got "$raw". Fix $key in assets/config/env.default.',
      );
    }
    return fallback;
  }
}
