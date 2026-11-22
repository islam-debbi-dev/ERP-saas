/// App routes outside the role tabs (the tabs come from `RoleScreens`).
/// Pushed on the root navigator so they cover the bottom bar.
class Routes {
  Routes._();

  // Launch and session.
  static const splash = '/splash';
  static const login = '/login';

  /// Forced change of a temporary password.
  static const passwordRequired = '/password-required';

  /// Office role or no mobile module.
  static const refused = '/refused';

  /// Where the splash sends a signed-in user; the redirect picks the role home.
  static const home = '/home';

  // Account (reached from the "Plus" tab of every role).
  static const changePassword = '/account/password';
  static const helpCenter = '/account/help';
  static const privacyPolicy = '/account/privacy';
}
