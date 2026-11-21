import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'api_language.dart';
import 'token_storage.dart';

/// Adds `Authorization` + `Accept-Language` to every request and transparently
/// refreshes an expired access token once, then retries the original request.
///
/// Queued so concurrent 401s trigger a single `POST /auth/refresh` — the
/// backend rotates refresh tokens (single use), so a second parallel refresh
/// with the same token would be treated as reuse and revoke every session.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor(this._dio);

  /// The app's main client (its base URL is reused for refresh + retry).
  final Dio _dio;

  /// Client without this interceptor, for `POST /auth/refresh` and for the
  /// replay. Replaying through [_dio] would deadlock: if the replay fails,
  /// its `onError` waits in this queue behind the `onError` awaiting it.
  late final Dio _bare = Dio(
    BaseOptions(
      baseUrl: _dio.options.baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
      headers: {'Accept': 'application/json'},
    ),
  );

  /// Called after a refresh fails (revoked/expired session) so the app can
  /// drop the user back to the guest state.
  static VoidCallback? onSessionExpired;

  static const _retriedKey = 'auth_retried';

  /// Endpoints where a 401 means "bad credentials", not "expired token".
  static const _noRefreshPaths = [
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/forgot-password',
    '/auth/reset-password',
  ];

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers['Accept-Language'] = await ApiLanguage.resolve();
    final token = await TokenStorage.readAccessToken();
    if (token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final options = err.requestOptions;
    final shouldRefresh =
        err.response?.statusCode == 401 &&
        options.extra[_retriedKey] != true &&
        !_noRefreshPaths.any(options.path.endsWith);
    if (!shouldRefresh) return handler.next(err);

    final refreshToken = await TokenStorage.readRefreshToken();
    if (refreshToken.isEmpty) return handler.next(err);

    // Another queued request may already have refreshed while this one waited.
    final sentToken = (options.headers['Authorization'] as String?)
        ?.replaceFirst('Bearer ', '');
    final currentToken = await TokenStorage.readAccessToken();
    final alreadyRefreshed =
        currentToken.isNotEmpty && currentToken != sentToken;

    if (!alreadyRefreshed && !await _refresh(refreshToken)) {
      await TokenStorage.clear();
      onSessionExpired?.call();
      return handler.next(err);
    }

    try {
      options.extra[_retriedKey] = true;
      options.headers['Authorization'] =
          'Bearer ${await TokenStorage.readAccessToken()}';
      handler.resolve(await _bare.fetch<dynamic>(options));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// `POST /auth/refresh` on the bare client so this interceptor never re-enters.
  Future<bool> _refresh(String refreshToken) async {
    try {
      debugPrint('AuthInterceptor: access token expired, refreshing');
      final response = await _bare.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = response.data?['data'];
      if (data is! Map<String, dynamic>) return false;
      final access = data['accessToken'] as String?;
      final refresh = data['refreshToken'] as String?;
      if (access == null || refresh == null) return false;
      await TokenStorage.save(accessToken: access, refreshToken: refresh);
      return true;
    } catch (e) {
      debugPrint('AuthInterceptor: token refresh failed: $e');
      return false;
    }
  }
}
