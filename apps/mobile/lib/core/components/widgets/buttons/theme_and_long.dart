import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../localization/locale_cubit.dart';
import '../../../localization/tr.dart';
import '../../../theme/cubit/theme_cubit.dart';
import 'common_list_button.dart';
import 'common_list_button_theme.dart';

/// Appearance (light / dark / system) and language (ar / fr / en) settings.
class ThemeAndLangWidget extends StatelessWidget {
  const ThemeAndLangWidget({super.key});

  /// The app languages, each named in its own language.
  static const languages = [
    ('ar', 'العربية'),
    ('fr', 'Français'),
    ('en', 'English'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.getListButtonThemeColors();
    final card = Theme.of(context).cardColor;
    final themeMode = context.select((ThemeCubit c) => c.state.themeMode);
    final language = context.select(
      (LocaleCubit c) => c.state.locale.languageCode,
    );

    CommonListButton option({
      required String label,
      required IconData? icon,
      required bool selected,
      required VoidCallback onPressed,
    }) => CommonListButton(
      label: label,
      leadingIcon: icon,
      trailingIcon: selected ? Icons.check : null,
      onPressed: onPressed,
      normalColor: card,
      textColor: colors.textColor,
      iconColor: colors.iconColor,
    );

    CommonListButton themeOption(String key, IconData icon, ThemeMode mode) =>
        option(
          label: context.tr(key),
          icon: icon,
          selected: themeMode == mode,
          onPressed: () {
            if (themeMode != mode) context.read<ThemeCubit>().setTheme(mode);
          },
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CommonListButton(
          label: context.tr('settings.appearance'),
          leadingIcon: Icons.palette_outlined,
          onPressed: () {},
          normalColor: card,
          textColor: colors.textColor,
          iconColor: colors.iconColor,
          childButtons: [
            themeOption('settings.light', Icons.light_mode, ThemeMode.light),
            themeOption('settings.dark', Icons.dark_mode, ThemeMode.dark),
            themeOption(
              'settings.system',
              Icons.brightness_auto,
              ThemeMode.system,
            ),
          ],
        ),
        CommonListButton(
          label: context.tr('settings.language'),
          leadingIcon: Icons.translate,
          onPressed: () {},
          normalColor: card,
          textColor: colors.textColor,
          iconColor: colors.iconColor,
          childButtons: [
            for (final (code, name) in languages)
              option(
                label: name,
                icon: null,
                selected: language == code,
                onPressed: () =>
                    context.read<LocaleCubit>().switchLocale(Locale(code)),
              ),
          ],
        ),
      ],
    );
  }
}
