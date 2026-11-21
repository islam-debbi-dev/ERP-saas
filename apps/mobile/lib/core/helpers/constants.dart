/// Keys of the values kept on the phone (secure storage / shared prefs).
class SharedPrefKeys {
  SharedPrefKeys._();

  static const String userToken = 'userToken';
  static const String refreshToken = 'refreshToken';

  /// Last `GET /auth/me` answer, for an offline start.
  static const String cachedUser = 'cachedUser';
}

/// Global connectivity state, written by `ConnectivityService`.
class ConnectivityState {
  ConnectivityState._();

  static bool isOffline = false;
}
