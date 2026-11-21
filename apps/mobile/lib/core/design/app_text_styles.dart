import 'package:flutter/material.dart';

/// Type scale for the app. Styles carry size / weight / height only; colour
/// comes from the theme so light and dark mode both stay readable.
class AppTextStyles {
  AppTextStyles._();

  static const String fontFamily = 'Almarai';

  static const TextStyle display = TextStyle(
    fontSize: 30,
    fontWeight: FontWeight.w800,
    height: 1.2,
  );
  static const TextStyle h1 = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w800,
    height: 1.25,
  );
  static const TextStyle h2 = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    height: 1.3,
  );
  static const TextStyle h3 = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w700,
    height: 1.3,
  );
  static const TextStyle bodyLarge = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.45,
  );
  static const TextStyle body = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.45,
  );
  static const TextStyle caption = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.35,
  );
  static const TextStyle button = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w700,
    height: 1.2,
  );
  static const TextStyle label = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w700,
    height: 1.2,
  );

  /// Material [TextTheme] built from the scale above.
  static TextTheme textTheme({required Color primary, required Color muted}) {
    return TextTheme(
      displayLarge: display.copyWith(color: primary),
      displayMedium: h1.copyWith(color: primary),
      displaySmall: h2.copyWith(color: primary),
      headlineLarge: h1.copyWith(color: primary),
      headlineMedium: h2.copyWith(color: primary),
      headlineSmall: h3.copyWith(color: primary),
      titleLarge: h2.copyWith(color: primary),
      titleMedium: h3.copyWith(color: primary),
      titleSmall: label.copyWith(color: primary),
      bodyLarge: bodyLarge.copyWith(color: primary),
      bodyMedium: body.copyWith(color: primary),
      bodySmall: caption.copyWith(color: muted),
      labelLarge: button.copyWith(color: primary),
      labelMedium: label.copyWith(color: primary),
      labelSmall: caption.copyWith(color: muted),
    );
  }
}
