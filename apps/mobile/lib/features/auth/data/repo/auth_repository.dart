import '../../../../core/models/auth_user.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/token_storage.dart';

/// `/auth/*` of the ERP API (`apps/api/src/auth/auth.controller.ts`).
/// Users are invited from the web: no register, no forgot password here.
/// Every request carries `X-Client-Type: native` (DioGenerate), so login and
/// refresh return the refresh token in the body. The interceptor refreshes.
class AuthRepository {
  AuthRepository(this._client, {TokenStore? tokens})
    : _tokens = tokens ?? const SecureTokenStore();

  final ApiClient _client;
  final TokenStore _tokens;

  /// `POST /auth/login`. [identifier] is an email or a phone number.
  /// Stores the token pair on success.
  Future<ApiResult<AuthSession>> login({
    required String identifier,
    required String password,
    required String deviceName,
  }) async {
    final result = await _client.post<AuthSession>(
      '/auth/login',
      data: {
        'identifier': identifier.trim(),
        'password': password,
        'deviceName': deviceName,
      },
      decode: (json) => AuthSession.fromJson(json.asMap),
    );
    if (result case Success(:final data)) {
      await _tokens.save(
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      );
    }
    return result;
  }

  Future<ApiResult<AuthUser>> me() =>
      _client.get('/auth/me', decode: (json) => AuthUser.fromJson(json.asMap));

  /// `POST /auth/password`: clears a temporary password and closes the user's
  /// other sessions; this one stays open. Returns the updated user.
  Future<ApiResult<AuthUser>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) => _client.post(
    '/auth/password',
    data: {'currentPassword': currentPassword, 'newPassword': newPassword},
    decode: (json) => AuthUser.fromJson(json.asMap),
  );

  /// `POST /auth/logout` revokes this session (frees the mobile seat), then the
  /// tokens are cleared whatever the answer: an offline logout still signs out
  /// on the phone (the session then expires on its own).
  Future<void> logout() async {
    await _client.post<Object?>('/auth/logout');
    await _tokens.clear();
  }

  /// Drops the tokens without calling the API (session already closed).
  Future<void> clearLocal() => _tokens.clear();

  Future<bool> hasStoredSession() async =>
      (await _tokens.readRefreshToken()).isNotEmpty;
}
