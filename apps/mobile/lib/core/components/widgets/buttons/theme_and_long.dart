import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../localization/app_localizations.dart';
import '../../../localization/locale_cubit.dart';
import '../../../theme/cubit/theme_cubit.dart';
import 'common_list_button.dart';
import 'common_list_button_theme.dart';

class ThemeAndLangWidget extends StatefulWidget {
  const ThemeAndLangWidget({super.key});

  @override
  State<ThemeAndLangWidget> createState() => _ThemeAndLangWidgetState();
}

class _ThemeAndLangWidgetState extends State<ThemeAndLangWidget> {
  @override
  Widget build(BuildContext context) {
    final themeColors = context.getListButtonThemeColors();
    final localizations = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // SectionTitle(
        //   localizations?.translate('account_settings') ?? 'Account Settings',
        // ),
        // CommonListButton(
        //   label: localizations?.translate('account') ?? 'account',
        //   leadingIcon: Icons.person,
        //   trailingIcon: Icons.arrow_forward_ios,
        //   onPressed: () {
        //     context.push(ConstantsRouter.accountInformationScreen);
        //   },
        //   normalColor: Theme.of(context).cardColor,
        //   textColor: themeColors.textColor,
        //   iconColor: themeColors.iconColor,
        // ),

        // CommonListButton(
        //   label:
        //       localizations?.translate('privacy_security') ??
        //       'Privacy & Security',
        //   leadingIcon: Icons.security,
        //   trailingIcon: Icons.arrow_forward_ios,
        //   normalColor: Theme.of(context).cardColor,
        //   textColor: themeColors.textColor,
        //   iconColor: themeColors.iconColor,
        //   onPressed: () {},
        // ),
        // CommonListButton(
        //   label: localizations?.translate('about') ?? 'About',
        //   leadingIcon: Icons.info,
        //   onPressed: () {},
        //   normalColor: Theme.of(context).cardColor,
        //   textColor: themeColors.textColor,
        //   iconColor: themeColors.iconColor,
        // ),

        // SectionTitle(localizations?.translate('settings') ?? 'Settings'),
        CommonListButton(
          label: localizations?.translate('appearance') ?? 'Appearance',
          leadingIcon: Icons.palette,
          onPressed: () {},
          expandedInitially: false,
          normalColor: Theme.of(context).cardColor,
          textColor: themeColors.textColor,
          iconColor: themeColors.iconColor,
          onExpandChanged: (isExpanded) {
            // Handle expansion change
          },
          childButtons: [
            CommonListButton(
              label: localizations?.translate('light_theme') ?? 'Light Theme',
              onPressed: () async {
                if (ThemeMode.light ==
                    context.read<ThemeCubit>().state.themeMode) {
                  return;
                }
                await context.read<ThemeCubit>().setTheme(ThemeMode.light);
              },
              leadingIcon: Icons.light_mode,
              normalColor: Theme.of(context).cardColor,
              textColor: themeColors.textColor,
              iconColor: themeColors.iconColor,
            ),
            CommonListButton(
              label: localizations?.translate('dark_theme') ?? 'Dark Theme',
              onPressed: () async {
                if (ThemeMode.dark ==
                    context.read<ThemeCubit>().state.themeMode) {
                  return;
                }
                await context.read<ThemeCubit>().setTheme(ThemeMode.dark);
              },
              leadingIcon: Icons.dark_mode,
              normalColor: Theme.of(context).cardColor,
              textColor: themeColors.textColor,
              iconColor: themeColors.iconColor,
            ),
            CommonListButton(
              label:
                  localizations?.translate('system_default') ??
                  'System Default',
              onPressed: () async {
                if (ThemeMode.system ==
                    context.read<ThemeCubit>().state.themeMode) {
                  return;
                }
                await context.read<ThemeCubit>().setTheme(ThemeMode.system);
              },
              leadingIcon: Icons.brightness_auto,
              normalColor: Theme.of(context).cardColor,
              textColor: themeColors.textColor,
              iconColor: themeColors.iconColor,
            ),
          ],
        ),

        // ===== NESTED SUBMENU =====
        CommonListButton(
          label:
              localizations?.translate('language_region') ??
              'Language & Region',
          leadingIcon: Icons.language,
          onPressed: () {},
          expandedInitially: false,
          normalColor: Theme.of(context).cardColor,
          textColor: themeColors.textColor,
          iconColor: themeColors.iconColor,
          childButtons: [
            CommonListButton(
              label: localizations?.translate('language') ?? 'Language',
              leadingIcon: Icons.translate,
              onPressed: () {},
              normalColor: Theme.of(context).cardColor,
              textColor: themeColors.textColor,
              iconColor: themeColors.iconColor,
              childButtons: [
                CommonListButton(
                  label: localizations?.translate('english') ?? 'English',
                  onPressed: () {
                    context.read<LocaleCubit>().switchLocale(
                      const Locale('en'),
                    );
                  },
                  trailingIcon:
                      context.select(
                            (LocaleCubit c) => c.state.locale.languageCode,
                          ) ==
                          'en'
                      ? Icons.check
                      : null,
                  normalColor: Theme.of(context).cardColor,
                  textColor: themeColors.textColor,
                  iconColor: themeColors.iconColor,
                ),
                CommonListButton(
                  label: localizations?.translate('arabic') ?? 'Arabic',
                  onPressed: () {
                    context.read<LocaleCubit>().switchLocale(
                      const Locale('ar'),
                    );
                  },
                  trailingIcon:
                      context.select(
                            (LocaleCubit c) => c.state.locale.languageCode,
                          ) ==
                          'ar'
                      ? Icons.check
                      : null,
                  normalColor: Theme.of(context).cardColor,
                  textColor: themeColors.textColor,
                  iconColor: themeColors.iconColor,
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }
}
