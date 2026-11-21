import 'package:dio/dio.dart';

import '../service/api_error_handler.dart';
import '../service/api_result.dart';
import '../service/dio_generate.dart';

/// Decodes a single typed value from the JSON object the API returns.
typedef FromJson<T> = T Function(Map<String, dynamic> json);

/// Thin, typed HTTP client shared by every feature repository.
///
/// Built on the app's single [Dio] instance ([DioGenerate.getDio]) so the
/// auth/refresh/logging interceptors keep applying to every request. Every
/// call returns an [ApiResult<T>] — never a bare `dynamic` — and every
/// failure funnels through the shared [ErrorHandler.handle], mirroring the
/// per-call-site mapping the legacy `Api` class used but centralized here.
class ApiClient {
  ApiClient({Dio? dio}) : _dio = dio ?? DioGenerate.getDio();

  final Dio _dio;

  /// The underlying [Dio], for the rare legacy call sites that still need raw
  /// access (e.g. multipart uploads done through `Api().dio`).
  Dio get dio => _dio;

  Future<ApiResult<T>> get<T>(
    String path, {
    Map<String, dynamic>? query,
    FromJson<T>? fromJson,
  }) async {
    try {
      final response = await _dio.get<dynamic>(path, queryParameters: query);
      return _map(response, fromJson);
    } on DioException catch (e) {
      return ApiResult.failure(ErrorHandler.handle(e));
    }
  }

  Future<ApiResult<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? query,
    FromJson<T>? fromJson,
  }) async {
    try {
      final response =
          await _dio.post<dynamic>(path, data: data, queryParameters: query);
      return _map(response, fromJson);
    } on DioException catch (e) {
      return ApiResult.failure(ErrorHandler.handle(e));
    }
  }

  Future<ApiResult<T>> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? query,
    FromJson<T>? fromJson,
  }) async {
    try {
      final response =
          await _dio.put<dynamic>(path, data: data, queryParameters: query);
      return _map(response, fromJson);
    } on DioException catch (e) {
      return ApiResult.failure(ErrorHandler.handle(e));
    }
  }

  Future<ApiResult<T>> patch<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? query,
    FromJson<T>? fromJson,
  }) async {
    try {
      final response =
          await _dio.patch<dynamic>(path, data: data, queryParameters: query);
      return _map(response, fromJson);
    } on DioException catch (e) {
      return ApiResult.failure(ErrorHandler.handle(e));
    }
  }

  Future<ApiResult<void>> delete(
    String path, {
    dynamic data,
    Map<String, dynamic>? query,
  }) async {
    try {
      final response =
          await _dio.delete<dynamic>(path, data: data, queryParameters: query);
      if (_isSuccess(response.statusCode)) {
        return const ApiResult<void>.success(null);
      }
      return ApiResult.failure(_failure(response));
    } on DioException catch (e) {
      return ApiResult.failure(ErrorHandler.handle(e));
    }
  }

  ApiResult<T> _map<T>(Response<dynamic> response, FromJson<T>? fromJson) {
    if (_isSuccess(response.statusCode)) {
      if (fromJson == null) {
        return ApiResult<T>.success(response.data as T);
      }
      final data = response.data;
      if (data is Map<String, dynamic>) {
        try {
          return ApiResult<T>.success(fromJson(data));
        } catch (e) {
          return ApiResult.failure(ErrorHandler.handle(e));
        }
      }
      return ApiResult.failure(
        ErrorHandler.fromMessage('Unexpected response format'),
      );
    }
    return ApiResult.failure(_failure(response));
  }

  bool _isSuccess(int? statusCode) =>
      statusCode != null && statusCode >= 200 && statusCode < 300;

  /// Builds the failure for a non-2xx response the same way Dio's `badResponse`
  /// path does, so the shared [ErrorHandler.handle] decodes the body into an
  /// [ApiErrorModel] (used on web, where 4xx responses are returned, not thrown).
  ErrorHandler _failure(Response<dynamic> response) {
    return ErrorHandler.handle(
      DioException.badResponse(
        statusCode: response.statusCode ?? -1,
        requestOptions: response.requestOptions,
        response: response,
      ),
    );
  }
}
