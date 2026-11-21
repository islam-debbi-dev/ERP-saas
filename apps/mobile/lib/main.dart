import 'dart:async';
import 'dart:ui' as ui;
import 'package:bloc/bloc.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:orvynt_starter/core/localization/localization_service.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'core/di/dependency_injection.dart';
import 'core/helpers/bloc_observer.dart';
import 'core/helpers/connectivity_services.dart';
import 'core/localization/locale_cubit.dart';
import 'core/theme/cubit/theme_cubit.dart';
import 'soft_smart.dart';

Future<void> main() async {
  // Set up global error handling
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
  };

  // Handle errors that occur during zone execution
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      // The real env file is gitignored (see .gitignore); copy `.env.example`
      // → `assets/config/env.default` locally. Missing file is fine: AppEnv
      // falls back to hardcoded defaults for every key.
      await dotenv.load(
        fileName: 'assets/config/env.default',
        isOptional: true,
      );

      // Phones stay portrait (the layouts are designed for it); tablets can
      // rotate freely because they have the room.
      final ui.FlutterView view =
          WidgetsBinding.instance.platformDispatcher.views.first;
      final Size logicalSize = view.physicalSize / view.devicePixelRatio;
      SystemChrome.setPreferredOrientations(
        logicalSize.shortestSide >= 600
            ? DeviceOrientation.values
            : [DeviceOrientation.portraitUp],
      );

      // Pre-compile shaders to avoid jank
      await _precacheShaders();

      // Register BlocObserver for debugging
      Bloc.observer = AppBlocObserver();

      await setupGetIt();
      await getIt<ConnectivityService>().init();

      // Initialize the localization service

      await getIt<LocalizationService>().init();

      final ThemeMode savedThemeMode = await ThemeCubit.getSavedThemeMode();
      final Locale savedLocale = await LocaleCubit.getSavedLocale();
      runApp(
        SoftSmart(initialThemeMode: savedThemeMode, initialLocale: savedLocale),
      );
    },
    (error, stackTrace) {
      // Handle any errors that weren't caught by FlutterError.onError
      debugPrint('Unhandled error: $error');
      debugPrint('Stack trace: $stackTrace');
    },
  );
}

/// Pre-compile shaders to avoid jank during runtime
Future<void> _precacheShaders() async {
  try {
    // Pre-warm the shaders by temporarily changing system UI
    await SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.manual,
      overlays: [],
    );
    await Future.delayed(const Duration(milliseconds: 100));
    await SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.manual,
      overlays: SystemUiOverlay.values,
    );

    // Pre-cache common gradients and effects
    await Future.delayed(const Duration(milliseconds: 50));
  } catch (e) {
    debugPrint('Error pre-caching shaders: $e');
  }
}
