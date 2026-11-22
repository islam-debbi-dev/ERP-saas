import '../helpers/constants.dart';
import '../helpers/shared_pref_helper.dart';

/// Access / refresh token persistence, backed by `flutter_secure_storage`.
///
/// The access token keeps the legacy [SharedPrefKeys.userToken] key so code
/// that already checks "is logged in" through it keeps working.
class TokenStorage {
  TokenStorage._();

  static Future<String> readAccessToken() =>
      SharedPrefHelper.getSecuredString(SharedPrefKeys.userToken);

  static Future<String> readRefreshToken() =>
      SharedPrefHelper.getSecuredString(SharedPrefKeys.refreshToken);

  static Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) async {
    await SharedPrefHelper.setSecuredString(
      SharedPrefKeys.userToken,
      accessToken,
    );
    await SharedPrefHelper.setSecuredString(
      SharedPrefKeys.refreshToken,
      refreshToken,
    );
  }

  static Future<void> clear() async {
    await SharedPrefHelper.removeSecuredData(SharedPrefKeys.userToken);
    await SharedPrefHelper.removeSecuredData(SharedPrefKeys.refreshToken);
  }
}

/// What [AuthInterceptor] needs from token persistence (a fake in tests).
abstract class TokenStore {
  Future<String> readAccessToken();
  Future<String> readRefreshToken();
  Future<void> save({
    required String accessToken,
    required String refreshToken,
  });
  Future<void> clear();
}

/// [TokenStore] on `flutter_secure_storage`, through [TokenStorage].
class SecureTokenStore implements TokenStore {
  const SecureTokenStore();

  @override
  Future<String> readAccessToken() => TokenStorage.readAccessToken();

  @override
  Future<String> readRefreshToken() => TokenStorage.readRefreshToken();

  @override
  Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) => TokenStorage.save(accessToken: accessToken, refreshToken: refreshToken);

  @override
  Future<void> clear() => TokenStorage.clear();
}
