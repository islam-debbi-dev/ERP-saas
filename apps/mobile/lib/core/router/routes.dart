/// App routes. Tabs live in the shell; everything else is pushed on the root
/// navigator so it covers the bottom bar.
class Routes {
  Routes._();

  // Launch and session.
  static const splash = '/splash';
  static const login = '/login';

  /// Forced change of a temporary password.
  static const passwordRequired = '/password-required';

  /// Office role or no mobile module.
  static const refused = '/refused';

  /// Where the splash sends a signed-in user; the redirect picks the screen.
  static const home = '/home';

  // Account.
  static const account = '/account';
  static const changePassword = '/account/password';
  static const helpCenter = '/account/help';
  static const privacyPolicy = '/account/privacy';
}
