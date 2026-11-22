import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'locale_cubit.dart';

/// A service to handle localization outside of the widget tree.
/// This is useful for background services, notifications, etc.
class LocalizationService {
  static final LocalizationService _instance = LocalizationService._internal();
  factory LocalizationService() => _instance;
  LocalizationService._internal();

  Map<String, String> _localizedStrings = {};
  String _currentLanguageCode = 'ar'; // Arabic by default (RTL)

  /// Initializes the localization service by loading the strings for the current locale.
  Future<void> init() async {
    try {
      final savedLocale = await LocaleCubit.getSavedLocale();
      _currentLanguageCode = savedLocale.languageCode;
      await _loadLocalizedStrings(_currentLanguageCode);
    } catch (e) {
      debugPrint('Error initializing LocalizationService: $e');
      // Fallback to default language if something goes wrong
      await _loadLocalizedStrings('ar');
    }
  }

  /// Loads the localization file for the given language code.
  Future<void> _loadLocalizedStrings(String languageCode) async {
    try {
      String jsonString = await rootBundle.loadString(
        'lib/core/localization/$languageCode.json',
      );
      Map<String, dynamic> jsonMap = json.decode(jsonString);
      _localizedStrings = jsonMap.map((key, value) {
        return MapEntry(key, value.toString());
      });
      _currentLanguageCode = languageCode;
    } catch (e) {
      debugPrint('Error loading localization for $languageCode: $e');
    }
  }

  /// Translates a given key into the currently loaded language.
  /// Returns the key itself if the translation is not found.
  String translate(String key) {
    return _localizedStrings[key] ?? key;
  }
}
