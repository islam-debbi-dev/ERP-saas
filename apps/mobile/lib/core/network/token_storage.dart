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
