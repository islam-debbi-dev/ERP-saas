import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../helpers/shared_pref_helper.dart';
part 'theme_state.dart';

const String themeModeKey = 'theme_mode';

class ThemeCubit extends Cubit<ThemeState> {
  ThemeCubit(ThemeMode initialMode) : super(ThemeState(themeMode: initialMode));

  /// Follows the phone's setting until the user picks light or dark.
  static Future<ThemeMode> getSavedThemeMode() async {
    final String mode = await SharedPrefHelper.getString(themeModeKey);
    if (mode == 'dark') return ThemeMode.dark;
    if (mode == 'light') return ThemeMode.light;
    return ThemeMode.system;
  }

  Future<void> toggleTheme() => setTheme(
    state.themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark,
  );

  Future<void> setTheme(ThemeMode mode) async {
    emit(ThemeState(themeMode: mode));
    await SharedPrefHelper.setData(themeModeKey, mode.name);
  }
}
