import '../localization/locale_cubit.dart';

/// The language the backend localizes `name` / `description` into.
///
/// The backend only supports `ar` and `en` (`resolveLang` falls back to `ar`
/// for anything else), so French maps to English rather than silently
/// returning Arabic copy.
class ApiLanguage {
  ApiLanguage._();

  static String _current = 'ar';

  /// Last language sent to the API. Used to resolve the rare `{ar, en}`
  /// objects the backend leaves unlocalized (e.g. a populated `storeId.name`).
  static String get current => _current;

  static String fromLocaleCode(String code) => code == 'ar' ? 'ar' : 'en';

  static Future<String> resolve() async {
    final locale = await LocaleCubit.getSavedLocale();
    _current = fromLocaleCode(locale.languageCode);
    return _current;
  }
}
