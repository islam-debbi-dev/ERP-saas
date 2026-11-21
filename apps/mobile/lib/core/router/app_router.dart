import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/ui/account_screen.dart';
import '../../features/account/ui/help_center_screen.dart';
import '../../features/account/ui/privacy_policy_screen.dart';
import '../../features/auth/ui/change_password_screen.dart';
import '../../features/auth/ui/login_screen.dart';
import '../../features/auth/ui/refused_screen.dart';
import '../../features/main_screen/ui/main_screen.dart';
import '../../features/splash/ui/splash_screen.dart';
import '../di/dependency_injection.dart';
import '../session/session_cubit.dart';
import '../session/session_state.dart';
import 'routes.dart';

final _rootKey = GlobalKey<NavigatorState>();

/// Where [session] may be, given the requested [path]: null keeps the path.
String? sessionRedirect(SessionState session, String path) {
  // The splash leaves by itself once its animation and the restore are done.
  if (path == Routes.splash) return null;
  switch (session.status) {
    case SessionStatus.unknown:
      return Routes.splash;
    case SessionStatus.signedOut:
      return path == Routes.login ? null : Routes.login;
    case SessionStatus.mustChangePassword:
      return path == Routes.passwordRequired ? null : Routes.passwordRequired;
    case SessionStatus.refused:
      return path == Routes.refused ? null : Routes.refused;
    case SessionStatus.signedIn:
      const sessionPaths = {
        Routes.login,
        Routes.passwordRequired,
        Routes.refused,
        Routes.home,
      };
      return sessionPaths.contains(path) ? Routes.account : null;
  }
}

final GoRouter appRouter = GoRouter(
  navigatorKey: _rootKey,
  initialLocation: Routes.splash,
  refreshListenable: _SessionListenable(getIt<SessionCubit>()),
  redirect: (context, state) =>
      sessionRedirect(getIt<SessionCubit>().state, state.uri.path),
  routes: [
    GoRoute(path: Routes.splash, builder: (_, _) => const LogoSplashScreen()),
    GoRoute(path: Routes.login, builder: (_, _) => const LoginScreen()),
    GoRoute(
      path: Routes.passwordRequired,
      builder: (_, _) => const ChangePasswordScreen(forced: true),
    ),
    GoRoute(
      path: Routes.refused,
      builder: (_, _) => RefusedScreen(
        refusal: getIt<SessionCubit>().state.refusal ?? Refusal.officeRole,
      ),
    ),
    GoRoute(
      path: Routes.changePassword,
      builder: (_, _) => const ChangePasswordScreen(),
    ),
    GoRoute(
      path: Routes.helpCenter,
      builder: (_, _) => const HelpCenterScreen(),
    ),
    GoRoute(
      path: Routes.privacyPolicy,
      builder: (_, _) => const PrivacyPolicyScreen(),
    ),
    StatefulShellRoute.indexedStack(
      builder: (_, _, shell) => MainScreen(navigationShell: shell),
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: Routes.account,
              builder: (_, _) => const AccountScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
  errorBuilder: (context, state) => Scaffold(
    appBar: AppBar(),
    body: Center(child: Text(state.uri.path)),
  ),
);

/// Re-runs the redirect when the session changes.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(SessionCubit cubit) {
    cubit.stream.listen((_) => notifyListeners());
  }
}
