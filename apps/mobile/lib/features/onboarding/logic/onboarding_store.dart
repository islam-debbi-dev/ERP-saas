import 'package:shared_preferences/shared_preferences.dart';

/// Remembers that the intro was shown, so it runs once per install.
class OnboardingStore {
  OnboardingStore._();

  static const _key = 'onboarding_seen';

  static Future<bool> seen() async =>
      (await SharedPreferences.getInstance()).getBool(_key) ?? false;

  static Future<void> markSeen() async =>
      (await SharedPreferences.getInstance()).setBool(_key, true);
}
