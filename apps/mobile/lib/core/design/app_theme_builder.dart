import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_theme.dart';
import 'app_spacing.dart';
import 'app_text_styles.dart';

/// Builds the single Material theme for the app, in light or dark.
///
/// Every component theme is set here once so screens never have to restyle
/// buttons, inputs, cards, dialogs, etc. on their own.
ThemeData buildAppTheme(Brightness brightness) {
  final bool dark = brightness == Brightness.dark;

  final Color action = dark ? AppColors.accent : AppColors.secondaryColor;
  final Color onAction = dark ? AppColors.ink : Colors.white;
  final Color bg = dark ? AppColors.darkBackground : AppColors.background;
  final Color surface = dark ? AppColors.darkSurface : AppColors.surface;
  final Color elevated = dark ? AppColors.darkElevated : AppColors.white;
  final Color text = dark ? Colors.white : AppColors.textPrimary;
  final Color muted = dark
      ? AppColors.darkTextSecondary
      : AppColors.textSecondary;
  final Color line = dark ? AppColors.darkDivider : AppColors.divider;
  final Color outline = dark ? AppColors.darkDivider : AppColors.border;

  final ColorScheme scheme = ColorScheme(
    brightness: brightness,
    primary: action,
    onPrimary: onAction,
    primaryContainer: dark ? AppColors.darkElevated : AppColors.accentTint,
    onPrimaryContainer: text,
    secondary: AppColors.primaryColor,
    onSecondary: AppColors.onPrimary,
    secondaryContainer: dark ? AppColors.darkElevated : AppColors.accentTint,
    onSecondaryContainer: text,
    error: AppColors.error,
    onError: Colors.white,
    surface: bg,
    onSurface: text,
    onSurfaceVariant: muted,
    outline: outline,
    outlineVariant: line,
    surfaceContainerLowest: bg,
    surfaceContainerLow: surface,
    surfaceContainer: surface,
    surfaceContainerHigh: elevated,
    surfaceContainerHighest: elevated,
    shadow: Colors.black,
    scrim: Colors.black,
    inverseSurface: dark ? Colors.white : AppColors.ink,
    onInverseSurface: dark ? AppColors.ink : Colors.white,
    inversePrimary: AppColors.accent,
  );

  final TextTheme textTheme = AppTextStyles.textTheme(
    primary: text,
    muted: muted,
  );

  final RoundedRectangleBorder buttonShape = RoundedRectangleBorder(
    borderRadius: AppRadius.mdAll,
  );
  const Size buttonMin = Size(64, AppSpacing.minTouch);

  OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: AppRadius.mdAll,
        borderSide: BorderSide(color: color, width: width),
      );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    fontFamily: AppTextStyles.fontFamily,
    textTheme: textTheme,
    primaryColor: AppColors.primaryColor,
    scaffoldBackgroundColor: bg,
    canvasColor: bg,
    cardColor: surface,
    dividerColor: line,
    disabledColor: dark ? AppColors.darkDivider : AppColors.border,
    shadowColor: Colors.black.withValues(alpha: 0.12),
    splashFactory: InkRipple.splashFactory,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    iconTheme: IconThemeData(color: text),
    dividerTheme: DividerThemeData(color: line, thickness: 1, space: 1),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: dark ? AppColors.accent : AppColors.ink,
      selectionColor: AppColors.accent.withValues(alpha: 0.45),
      selectionHandleColor: dark ? AppColors.accent : AppColors.ink,
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: CupertinoPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      },
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      foregroundColor: text,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
      titleTextStyle: textTheme.headlineMedium,
      iconTheme: IconThemeData(color: text),
      systemOverlayStyle: dark
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: action,
        foregroundColor: onAction,
        disabledBackgroundColor: line,
        disabledForegroundColor: muted,
        elevation: 0,
        minimumSize: buttonMin,
        shape: buttonShape,
        textStyle: AppTextStyles.button,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: action,
        foregroundColor: onAction,
        disabledBackgroundColor: line,
        disabledForegroundColor: muted,
        minimumSize: buttonMin,
        shape: buttonShape,
        textStyle: AppTextStyles.button,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: text,
        side: BorderSide(color: outline),
        minimumSize: buttonMin,
        shape: buttonShape,
        textStyle: AppTextStyles.button,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: text,
        shape: buttonShape,
        textStyle: AppTextStyles.label,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: text),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: AppColors.accent,
      foregroundColor: AppColors.ink,
      elevation: 2,
      // A pill: a plain (square) FAB stays a circle, an extended one (icon
      // and word) is not squeezed into a disc with its word hanging out.
      shape: const StadiumBorder(),
    ),
    // Deliberately minimal: many fields in the app draw their own container
    // and set `border: InputBorder.none`. Theme-level fill / enabled / focused
    // borders would override those, so only text styles and the default
    // outline shape live here.
    inputDecorationTheme: InputDecorationTheme(
      hintStyle: AppTextStyles.body.copyWith(color: muted),
      labelStyle: AppTextStyles.body.copyWith(color: muted),
      errorStyle: AppTextStyles.caption.copyWith(color: AppColors.error),
      prefixIconColor: muted,
      suffixIconColor: muted,
      border: inputBorder(outline),
    ),
    cardTheme: CardThemeData(
      color: surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.lgAll),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: surface,
      selectedColor: action,
      disabledColor: line,
      side: BorderSide.none,
      labelStyle: AppTextStyles.label.copyWith(color: text),
      secondaryLabelStyle: AppTextStyles.label.copyWith(color: onAction),
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: text,
      textColor: text,
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: elevated,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.xlAll),
      titleTextStyle: textTheme.headlineMedium,
      contentTextStyle: textTheme.bodyMedium,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: elevated,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: elevated,
      showDragHandle: true,
      dragHandleColor: outline,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.ink,
      contentTextStyle: AppTextStyles.body.copyWith(color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: text,
      unselectedLabelColor: muted,
      indicatorColor: AppColors.accent,
      dividerColor: line,
      labelStyle: AppTextStyles.label,
      unselectedLabelStyle: AppTextStyles.label,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.all(Colors.white),
      trackColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? AppColors.success : outline,
      ),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? action : null,
      ),
      checkColor: WidgetStateProperty.all(onAction),
      shape: RoundedRectangleBorder(borderRadius: AppRadius.smAll),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? action : outline,
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: dark ? AppColors.accent : AppColors.ink,
      linearTrackColor: line,
      circularTrackColor: line,
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: elevated,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
    ),
    dropdownMenuTheme: DropdownMenuThemeData(
      menuStyle: MenuStyle(
        backgroundColor: WidgetStateProperty.all(elevated),
        surfaceTintColor: WidgetStateProperty.all(Colors.transparent),
      ),
    ),
    scrollbarTheme: ScrollbarThemeData(
      radius: const Radius.circular(AppRadius.pill),
      thumbColor: WidgetStateProperty.all(outline),
    ),
  );
}
