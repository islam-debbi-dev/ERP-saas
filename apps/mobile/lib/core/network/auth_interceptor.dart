import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'api_language.dart';
import 'token_storage.dart';

/// Adds `Authorization` and `Accept-Language` to every request and, on a 401,
/// refreshes the access token once (`POST /auth/refresh { refreshToken }`)
/// then replays the request.
///
/// Queued so concurrent 401s make a single refresh: the API rotates refresh
/// tokens (single use), and a second refresh with the same token would be
/// seen as reuse and close the session.
///
/// A refresh the API rejects (revoked, expired, reused) ends the session.
/// A refresh that fails because the phone is offline does not: the tokens are
/// kept and the request fails with its network error.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor(this._dio, {TokenStore? store})
    : _store = store ?? const SecureTokenStore();

  final Dio _dio;
  final TokenStore _store;

  /// Client without this interceptor, for the refresh and the replay.
  /// Replaying through [_dio] would deadlock in the queue.
  late final Dio bare = Dio(
    BaseOptions(
      baseUrl: _dio.options.baseUrl,
      connectTimeout: _dio.options.connectTimeout,
      receiveTimeout: _dio.options.receiveTimeout,
      headers: Map<String, dynamic>.of(_dio.options.headers),
    ),
  )..httpClientAdapter = _dio.httpClientAdapter;

  /// Called when the API rejects the refresh token: the app goes to login.
  static VoidCallback? onSessionExpired;

  static const _retriedKey = 'auth_retried';

  /// Where a 401 means "bad credentials", not "expired access token".
  static const _noRefreshPaths = ['/auth/login', '/auth/refresh'];

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers['Accept-Language'] = await ApiLanguage.resolve();
    final token = await _store.readAccessToken();
    if (token.isNotEmpty) options.headers['Authorization'] = 'Bearer $token';
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

    final refreshToken = await _store.readRefreshToken();
    if (refreshToken.isEmpty) return handler.next(err);

    // Another queued request may have refreshed while this one waited.
    final sent = (options.headers['Authorization'] as String?)?.replaceFirst(
      'Bearer ',
      '',
    );
    final current = await _store.readAccessToken();
    final alreadyRefreshed = current.isNotEmpty && current != sent;

    if (!alreadyRefreshed) {
      final outcome = await _refresh(refreshToken);
      if (outcome == _Refresh.rejected) {
        await _store.clear();
        onSessionExpired?.call();
        return handler.next(err);
      }
      if (outcome == _Refresh.unreachable) return handler.next(err);
    }

    try {
      options.extra[_retriedKey] = true;
      options.headers['Authorization'] =
          'Bearer ${await _store.readAccessToken()}';
      handler.resolve(await bare.fetch<dynamic>(options));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Future<_Refresh> _refresh(String refreshToken) async {
    try {
      final response = await bare.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final body = response.data;
      final access = body?['accessToken'];
      final refresh = body?['refreshToken'];
      if (access is! String || refresh is! String) {
        debugPrint('AuthInterceptor: refresh answer without tokens');
        return _Refresh.rejected;
      }
      await _store.save(accessToken: access, refreshToken: refresh);
      return _Refresh.ok;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      // The API answered no (401 / 403): the session is over.
      if (status != null && status >= 400 && status < 500) {
        return _Refresh.rejected;
      }
      debugPrint('AuthInterceptor: refresh unreachable: ${e.type}');
      return _Refresh.unreachable;
    }
  }
}

enum _Refresh { ok, rejected, unreachable }
