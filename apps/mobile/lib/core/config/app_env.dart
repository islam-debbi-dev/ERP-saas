import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart' show Color;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:orvynt_starter/core/service/api_constants.dart';

/// Environment values. Loads from [assets/config/env.default] in main, then
/// optional `--dart-define=KEY=...` overrides (CI / local flags).
///
/// Priority order for every key: `--dart-define` > `.env` (the file bundled as
/// `assets/config/env.default`) > hardcoded fallback below.
class AppEnv {
  AppEnv._();

  static String _e(String k) {
    // Safe before/without a loaded dotenv (e.g. in widget tests or the splash
    // screen which may render before async env load finishes): uninitialized
    // simply means the fallback chain applies.
    if (!dotenv.isInitialized) return '';
    return dotenv.env[k]?.trim() ?? '';
  }

  /// Resolves a string key: `--dart-define` > `.env` > hardcoded [fallback].
  static String _str(String fromDefine, String key, String fallback) {
    if (fromDefine.isNotEmpty) return fromDefine;
    final env = _e(key);
    return env.isNotEmpty ? env : fallback;
  }

  // ── Hardcoded fallbacks (only used when the key is missing everywhere) ──
  // These must stay brand-neutral: a white-label client that forgets to set a
  // key should see a generic placeholder, never the previous client's brand.
  static const String _fallbackAppName = 'My App';
  static const String _fallbackLogoAsset = 'assets/main-logo.png';
  static const String _fallbackSupportEmail = 'support@jibli.org';
  static const String _fallbackPrivacyEmail = 'jiblimsila@gmail.com';
  static const Color _fallbackPrimaryColor = Color(0xFFFFD83A);
  static const Color _fallbackSecondaryColor = Color(0xFF1E1E1E);

  /// Optional override, e.g. `flutter run --dart-define=API_BASE_URL=https://...`
  static const String _apiFromDefine = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );
  static const String _appNameFromDefine = String.fromEnvironment(
    'APP_NAME',
    defaultValue: '',
  );
  static const String _primaryColorFromDefine = String.fromEnvironment(
    'APP_PRIMARY_COLOR',
    defaultValue: '',
  );
  static const String _secondaryColorFromDefine = String.fromEnvironment(
    'APP_SECONDARY_COLOR',
    defaultValue: '',
  );
  static const String _googleWebClientIdFromDefine = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
    defaultValue: '',
  );
  static const String _appleServiceIdFromDefine = String.fromEnvironment(
    'APPLE_SERVICE_ID',
    defaultValue: '',
  );
  static const String _logoAssetFromDefine = String.fromEnvironment(
    'APP_LOGO_ASSET',
    defaultValue: '',
  );
  static const String _supportEmailFromDefine = String.fromEnvironment(
    'SUPPORT_EMAIL',
    defaultValue: '',
  );
  static const String _privacyEmailFromDefine = String.fromEnvironment(
    'PRIVACY_EMAIL',
    defaultValue: '',
  );
  static const String _dashboardFromDefine = String.fromEnvironment(
    'DASHBOARD_URL',
    defaultValue: '',
  );

  static String get apiBaseUrl {
    if (_apiFromDefine.isNotEmpty) return _apiFromDefine;
    if (_e('API_BASE_URL').isNotEmpty) return _e('API_BASE_URL');
    return ApiConstants.baseUrl;
  }

  /// Web dashboard a store manager opens from "Manage my store".
  /// `DASHBOARD_URL` when set, else derived from the API host following the
  /// deploy convention (`api.<domain>` → `admin.<domain>`, see infra/Caddyfile).
  static String get dashboardUrl {
    final explicit = _str(_dashboardFromDefine, 'DASHBOARD_URL', '');
    if (explicit.isNotEmpty) return explicit;
    return dashboardUrlFromApi(apiBaseUrl);
  }

  /// `https://api.jibli.org/api/v1` → `https://admin.jibli.org`. Any other
  /// host keeps its origin (local dev: the API origin itself).
  static String dashboardUrlFromApi(String apiUrl) {
    final uri = Uri.tryParse(apiUrl);
    if (uri == null || uri.host.isEmpty) return '';
    final host = uri.host.startsWith('api.')
        ? 'dashboard.${uri.host.substring(4)}'
        : uri.host;
    return Uri(
      scheme: uri.scheme,
      host: host,
      port: uri.hasPort && host == uri.host ? uri.port : null,
    ).toString();
  }

  // ── App name / branding ────────────────────────────────────────────────────

  /// In-app name used as the MaterialApp `title` (task-switcher label).
  /// The home-screen launcher label is a separate native step (see the
  /// white-label onboarding doc).
  static String get appName =>
      _str(_appNameFromDefine, 'APP_NAME', _fallbackAppName);

  /// Asset path of the client's logo, drawn on the auth screen. Replace the
  /// file (or point this key elsewhere) per client — no code change needed.
  static String get logoAsset =>
      _str(_logoAssetFromDefine, 'APP_LOGO_ASSET', _fallbackLogoAsset);

  /// Contact address shown in Help Center. Shown only when non-empty.
  static String get supportEmail =>
      _str(_supportEmailFromDefine, 'SUPPORT_EMAIL', _fallbackSupportEmail);

  /// Contact address shown in Privacy Policy. Shown only when non-empty.
  static String get privacyEmail =>
      _str(_privacyEmailFromDefine, 'PRIVACY_EMAIL', _fallbackPrivacyEmail);

  // ── Brand colors ───────────────────────────────────────────────────────────

  static Color get primaryColor {
    if (_primaryColorFromDefine.isNotEmpty) {
      return _parseHexColor('APP_PRIMARY_COLOR', _primaryColorFromDefine);
    }
    final env = _e('APP_PRIMARY_COLOR');
    if (env.isNotEmpty) return _parseHexColor('APP_PRIMARY_COLOR', env);
    return _fallbackPrimaryColor;
  }

  static Color get secondaryColor {
    if (_secondaryColorFromDefine.isNotEmpty) {
      return _parseHexColor('APP_SECONDARY_COLOR', _secondaryColorFromDefine);
    }
    final env = _e('APP_SECONDARY_COLOR');
    if (env.isNotEmpty) return _parseHexColor('APP_SECONDARY_COLOR', env);
    return _fallbackSecondaryColor;
  }

  /// Parses `#RRGGBB` or `#AARRGGBB` (the leading `#` is optional). Fails
  /// loudly in debug builds with a clear error on malformed input instead of
  /// silently falling back. In release builds a bad value falls back to the
  /// default brand color so the app still boots.
  static Color _parseHexColor(String key, String raw) {
    var hex = raw.trim();
    if (hex.startsWith('#')) hex = hex.substring(1);
    final int? value = int.tryParse(hex, radix: 16);
    if (value != null && hex.length == 6) {
      return Color(0xFF000000 | value);
    }
    if (value != null && hex.length == 8) {
      return Color(value);
    }
    if (kDebugMode) {
      throw StateError(
        'AppEnv: $key must be a hex color like "#1B7F5E" (or "#AARRGGBB"), '
        'got "$raw". Fix $key in your .env / assets/config/env.default.',
      );
    }
    return key == 'APP_PRIMARY_COLOR'
        ? _fallbackPrimaryColor
        : _fallbackSecondaryColor;
  }

  // ── Social auth provider keys ──────────────────────────────────────────────

  /// Google OAuth Web/Server client ID used at runtime to request an ID token
  /// that is sent to the backend (see docs/white-label-client-onboarding.md).
  static String get googleWebClientId {
    if (_googleWebClientIdFromDefine.isNotEmpty) {
      return _googleWebClientIdFromDefine;
    }
    return _e('GOOGLE_WEB_CLIENT_ID');
  }

  static String get appleServiceId {
    if (_appleServiceIdFromDefine.isNotEmpty) return _appleServiceIdFromDefine;
    return _e('APPLE_SERVICE_ID');
  }

  /// Auth button is rendered only when the provider's key is set.
  static bool get hasGoogleAuth => googleWebClientId.isNotEmpty;
  static bool get hasAppleAuth => appleServiceId.isNotEmpty;
}
