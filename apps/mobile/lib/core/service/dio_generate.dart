import 'package:dio/dio.dart';
import 'package:pretty_dio_logger/pretty_dio_logger.dart';
import 'package:flutter/foundation.dart' show kDebugMode, kIsWeb;

import '../config/app_env.dart';
import '../network/auth_interceptor.dart';

class DioGenerate {
  static Dio? _dio; // Renamed for convention
  DioGenerate._internal();

  // getDio can now be synchronous as token fetching is deferred to the interceptor
  static Dio getDio() {
    if (_dio == null) {
      _dio = Dio();
      _dio!
        ..options.baseUrl = AppEnv.apiBaseUrl
        ..options.connectTimeout = const Duration(seconds: 15)
        ..options.receiveTimeout = const Duration(seconds: 30);

      // Web-specific configuration for UTF-8 encoding
      if (kIsWeb) {
        _dio!.options.responseType = ResponseType.json;
        _dio!.options.validateStatus = (status) {
          return status != null && status < 500;
        };
      }

      _setStaticHeaders(); // Sets non-dynamic headers
      _addDioInterceptors(); // Adds all interceptors including AuthInterceptor
    }
    return _dio!;
  }

  // Renamed and modified to set only static headers
  static void _setStaticHeaders() {
    if (kIsWeb) {
      // Web-specific headers for proper UTF-8 handling
      _dio!.options.headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json; charset=utf-8',
        'Accept-Charset': 'utf-8',
        // Authorization header will be added by AuthInterceptor
      };
    } else {
      // Mobile headers
      _dio!.options.headers = {
        'Accept': 'application/json',
        // Authorization header will be added by AuthInterceptor
      };
    }
  }

  /// Auth (bearer + refresh-on-401) and language headers, then debug logging.
  static void _addDioInterceptors() {
    _dio!.interceptors.add(AuthInterceptor(_dio!));
    if (kDebugMode) {
      _dio!.interceptors.add(
        PrettyDioLogger(
          requestHeader: true,
          requestBody: true,
          responseBody: true,
          error: true,
        ),
      );
    }
  }
}
