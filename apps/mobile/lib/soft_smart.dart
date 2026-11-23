import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'core/di/dependency_injection.dart';
import 'core/localization/app_localizations.dart';
import 'core/localization/locale_cubit.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme_dark.dart';
import 'core/theme/app_theme_light.dart';
import 'core/theme/cubit/theme_cubit.dart';
import 'core/session/session_cubit.dart';
import 'features/assistant/logic/assistant_status_cubit.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/config/app_env.dart';
import 'core/design/responsive.dart';

class SoftSmart extends StatefulWidget {
  const SoftSmart({
    super.key,
    required this.initialLocale,
    required this.initialThemeMode,
  });
  final ThemeMode initialThemeMode;

  final Locale initialLocale;
  @override
  State<SoftSmart> createState() => _SoftSmartState();
}

class _SoftSmartState extends State<SoftSmart> {
  // This widget is the root of your application.

  /// Design canvas for ScreenUtil. Phones are drawn at 375x812; tablets at
  /// 768x1024 so `.w` / `.sp` values do not blow up on a wide screen.
  late final Size _designSize = _isTabletDevice()
      ? const Size(768, 1024)
      : const Size(375, 812);

  bool _isTabletDevice() {
    final Iterable<ui.FlutterView> views =
        WidgetsBinding.instance.platformDispatcher.views;
    if (views.isEmpty) return false;
    final ui.FlutterView view = views.first;
    final Size logical = view.physicalSize / view.devicePixelRatio;
    return logical.shortestSide >= Breakpoints.tablet;
  }

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => ThemeCubit(widget.initialThemeMode)),
        BlocProvider(create: (_) => LocaleCubit(widget.initialLocale)),
        BlocProvider<SessionCubit>.value(value: getIt<SessionCubit>()),
        BlocProvider<AssistantStatusCubit>.value(
          value: getIt<AssistantStatusCubit>(),
        ),
      ],
      child: ScreenUtilInit(
        designSize: _designSize,
        minTextAdapt: true,
        builder: (context, child) {
          return BlocBuilder<ThemeCubit, ThemeState>(
            builder: (context, state) {
              return BlocBuilder<LocaleCubit, LocaleState>(
                builder: (context, localeState) {
                  return MaterialApp.router(
                    //  navigatorKey: NavigationService.navigatorKey,
                    theme: appThemeLight,
                    locale: localeState.locale,
                    supportedLocales: const [
                      Locale('ar'), // default, RTL
                      Locale('fr'),
                      Locale('en'),
                    ],
                    localizationsDelegates: [
                      const AppLocalizationsDelegate(),
                      GlobalMaterialLocalizations.delegate,
                      GlobalWidgetsLocalizations.delegate,
                      GlobalCupertinoLocalizations.delegate,
                    ],
                    darkTheme: appThemeDark,
                    themeMode: state.themeMode,
                    debugShowCheckedModeBanner: false,
                    // Add performance overlay in debug mode only
                    showPerformanceOverlay:
                        false, // Set to true for performance monitoring
                    title: AppEnv.appName,
                    builder: _appBuilder,
                    routerConfig: appRouter,
                    // home: TestDrawerPage(),
                  );
                },
              );
            },
          );
        },
      ),
    );
  }

  /// App-wide wrapper: caps the system font scale so very large accessibility
  /// sizes cannot break layouts, and centers content on wide screens.
  Widget _appBuilder(BuildContext context, Widget? child) {
    final MediaQueryData media = MediaQuery.of(context);
    final Widget content = child ?? const SizedBox.shrink();

    return MediaQuery(
      data: media.copyWith(
        textScaler: media.textScaler.clamp(
          minScaleFactor: 0.9,
          maxScaleFactor: 1.3,
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          const double maxWidth = 900;
          if (constraints.maxWidth <= maxWidth) return content;

          // Tablet / desktop width: keep a readable column in the middle
          // and tell descendants about the narrower width.
          final MediaQueryData inner = MediaQuery.of(context);
          return ColoredBox(
            color: Theme.of(context).scaffoldBackgroundColor,
            child: Center(
              child: SizedBox(
                width: maxWidth,
                child: MediaQuery(
                  data: inner.copyWith(size: Size(maxWidth, inner.size.height)),
                  child: content,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
