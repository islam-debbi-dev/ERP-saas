import '../../../../core/models/auth_user.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/token_storage.dart';
import '../../../../core/service/api_result.dart';
import '../models/address.dart';

/// `/me/*`: profile, password, account deletion, saved addresses, push token.
class AccountRepository {
  AccountRepository(this._client);

  final ApiClient _client;

  static Map<String, dynamic> _data(Map<String, dynamic> body) =>
      body['data'] as Map<String, dynamic>;

  Future<ApiResult<AuthUser>> getProfile() =>
      _client.get('/me', fromJson: (body) => AuthUser.fromJson(_data(body)));

  /// Avatar upload (multipart `avatar`) is not wired yet; JSON fields only.
  Future<ApiResult<AuthUser>> updateProfile({
    String? name,
    String? email,
    String? preferredLanguage,
  }) => _client.patch(
    '/me',
    data: {
      if (name != null) 'name': name,
      if (email != null) 'email': email,
      if (preferredLanguage != null) 'preferredLanguage': preferredLanguage,
    },
    fromJson: (body) => AuthUser.fromJson(_data(body)),
  );

  /// The backend revokes every session on success, so local tokens are
  /// cleared too and the caller must send the user back to login.
  Future<ApiResult<void>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final result = await _client.patch<void>(
      '/me/password',
      data: {'currentPassword': currentPassword, 'newPassword': newPassword},
      fromJson: (_) {},
    );
    if (result is Success<void>) await TokenStorage.clear();
    return result;
  }

  /// `DELETE /me` — permanent. The backend wipes personal data and revokes
  /// every session, so local tokens are cleared on success.
  Future<ApiResult<void>> deleteAccount({required String password}) async {
    final result = await _client.delete('/me', data: {'password': password});
    if (result is Success<void>) await TokenStorage.clear();
    return result;
  }

  Future<ApiResult<List<Address>>> getAddresses() => _client.get(
    '/me/addresses',
    fromJson: (body) => (body['data'] as List<dynamic>)
        .map((e) => Address.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  Future<ApiResult<Address>> createAddress(Address address) => _client.post(
    '/me/addresses',
    data: address.toJson(),
    fromJson: (body) => Address.fromJson(_data(body)),
  );

  Future<ApiResult<Address>> updateAddress(Address address) => _client.patch(
    '/me/addresses/${address.id}',
    data: address.toJson(),
    fromJson: (body) => Address.fromJson(_data(body)),
  );

  Future<ApiResult<void>> deleteAddress(String id) =>
      _client.delete('/me/addresses/$id');

  Future<ApiResult<void>> registerFcmToken(String token) =>
      _client.post('/me/fcm-token', data: {'token': token}, fromJson: (_) {});

  Future<ApiResult<void>> unregisterFcmToken(String token) =>
      _client.delete('/me/fcm-token', data: {'token': token});
}
