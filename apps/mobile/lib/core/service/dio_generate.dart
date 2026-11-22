import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:pretty_dio_logger/pretty_dio_logger.dart';

import '../config/app_env.dart';
import '../network/auth_interceptor.dart';

/// The app's single [Dio]: base URL from the env, the native client header,
/// auth + language + refresh, and request logs in debug builds.
class DioGenerate {
  DioGenerate._();

  /// Tells the API this is the phone app: the refresh token comes back in the
  /// body (not a cookie) and the session counts as a mobile seat.
  static const clientTypeHeader = 'X-Client-Type';
  static const clientTypeNative = 'native';

  static Dio? _dio;

  static Dio getDio() => _dio ??= create(AppEnv.apiBaseUrl);

  /// A configured client for [baseUrl] (tests build their own).
  static Dio create(String baseUrl, {bool log = kDebugMode}) {
    final dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        headers: {
          'Accept': 'application/json',
          clientTypeHeader: clientTypeNative,
        },
      ),
    );
    dio.interceptors.add(AuthInterceptor(dio));
    if (log) {
      dio.interceptors.add(
        PrettyDioLogger(requestBody: true, responseBody: false, error: true),
      );
    }
    return dio;
  }
}
