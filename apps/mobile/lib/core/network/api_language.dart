import '../localization/locale_cubit.dart';

/// The `Accept-Language` sent to the API: the app's locale (`ar`, `fr` or
/// `en`), Arabic for anything else.
class ApiLanguage {
  ApiLanguage._();

  static const supported = {'ar', 'fr', 'en'};

  static String _current = 'ar';

  /// Last language sent to the API.
  static String get current => _current;

  static String fromLocaleCode(String code) =>
      supported.contains(code) ? code : 'ar';

  static Future<String> resolve() async {
    final locale = await LocaleCubit.getSavedLocale();
    _current = fromLocaleCode(locale.languageCode);
    return _current;
  }
}
