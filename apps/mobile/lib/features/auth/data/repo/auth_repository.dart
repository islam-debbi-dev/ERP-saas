import '../../../../core/models/auth_user.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/token_storage.dart';
import '../../../../core/service/api_result.dart';

/// `/auth/*` for the client app. Successful login / register persist the
/// token pair; the Dio [AuthInterceptor] handles `/auth/refresh` on 401.
class AuthRepository {
  AuthRepository(this._client);

  final ApiClient _client;

  static Map<String, dynamic> _data(Map<String, dynamic> body) =>
      body['data'] as Map<String, dynamic>;

  Future<ApiResult<AuthSession>> login({
    required String phone,
    required String password,
  }) => _withSession(
    _client.post(
      '/auth/login',
      data: {'phone': phone, 'password': password, 'portal': 'app'},
      fromJson: (body) => AuthSession.fromJson(_data(body)),
    ),
  );

  /// `preferredLanguage` is `ar | en`.
  Future<ApiResult<AuthSession>> register({
    required String name,
    required String phone,
    required String password,
    String? email,
    String? preferredLanguage,
  }) => _withSession(
    _client.post(
      '/auth/register',
      data: {
        'name': name,
        'phone': phone,
        'password': password,
        if (email != null && email.isNotEmpty) 'email': email,
        if (preferredLanguage != null) 'preferredLanguage': preferredLanguage,
      },
      fromJson: (body) => AuthSession.fromJson(_data(body)),
    ),
  );

  Future<ApiResult<AuthUser>> me() => _client.get(
    '/auth/me',
    fromJson: (body) => AuthUser.fromJson(_data(body)),
  );

  /// Revokes this device's refresh token, then clears local tokens whatever
  /// the server answered (an offline logout must still sign out locally).
  Future<void> logout() async {
    final refreshToken = await TokenStorage.readRefreshToken();
    await _client.post<dynamic>(
      '/auth/logout',
      data: {if (refreshToken.isNotEmpty) 'refreshToken': refreshToken},
    );
    await TokenStorage.clear();
  }

  Future<void> logoutAll() async {
    await _client.post<dynamic>('/auth/logout-all');
    await TokenStorage.clear();
  }

  /// Always answers success (no account enumeration). Outside production the
  /// backend includes the 6-digit code as `devCode`; it is returned here so a
  /// debug build can prefill it.
  Future<ApiResult<String?>> forgotPassword(String phone) => _client.post(
    '/auth/forgot-password',
    data: {'phone': phone},
    fromJson: (body) => _data(body)['devCode'] as String?,
  );

  /// Revokes every session server-side; the user must log in again.
  Future<ApiResult<void>> resetPassword({
    required String phone,
    required String code,
    required String newPassword,
  }) => _client.post(
    '/auth/reset-password',
    data: {'phone': phone, 'code': code, 'newPassword': newPassword},
    fromJson: (_) {},
  );

  Future<ApiResult<AuthSession>> _withSession(
    Future<ApiResult<AuthSession>> request,
  ) async {
    final result = await request;
    if (result case Success(:final data)) {
      await TokenStorage.save(
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      );
    }
    return result;
  }
}
