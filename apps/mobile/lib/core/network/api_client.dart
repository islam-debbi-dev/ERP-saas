import 'package:dio/dio.dart';

import '../service/dio_generate.dart';
import 'api_error.dart';
import 'api_result.dart';
import 'idempotency_key.dart';

/// Decodes the JSON body of a successful response (an object, a list or a
/// scalar, depending on the endpoint).
typedef Decode<T> = T Function(Object? json);

/// Thin typed HTTP client shared by every repository.
///
/// The ERP API answers the DTO itself (no `{ data }` envelope) and errors as
/// `{ code, message, details? }`. Every call returns an [ApiResult]; failures
/// are [ApiError]s. Money / stock POSTs pass the form's [IdempotencyKey].
class ApiClient {
  ApiClient({Dio? dio}) : _dio = dio ?? DioGenerate.getDio();

  final Dio _dio;

  Dio get dio => _dio;

  Future<ApiResult<T>> get<T>(
    String path, {
    Map<String, dynamic>? query,
    Decode<T>? decode,
    CancelToken? cancelToken,
  }) => _send(
    () => _dio.get<Object?>(
      path,
      queryParameters: _clean(query),
      cancelToken: cancelToken,
    ),
    decode,
  );

  Future<ApiResult<T>> post<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? query,
    Decode<T>? decode,
    IdempotencyKey? idempotencyKey,
    CancelToken? cancelToken,
  }) => _send(
    () => _dio.post<Object?>(
      path,
      data: data,
      queryParameters: _clean(query),
      options: idempotencyKey?.options,
      cancelToken: cancelToken,
    ),
    decode,
  );

  Future<ApiResult<T>> put<T>(
    String path, {
    Object? data,
    Decode<T>? decode,
    IdempotencyKey? idempotencyKey,
  }) => _send(
    () => _dio.put<Object?>(path, data: data, options: idempotencyKey?.options),
    decode,
  );

  Future<ApiResult<T>> patch<T>(
    String path, {
    Object? data,
    Decode<T>? decode,
  }) => _send(() => _dio.patch<Object?>(path, data: data), decode);

  Future<ApiResult<T>> delete<T>(String path, {Decode<T>? decode}) =>
      _send(() => _dio.delete<Object?>(path), decode);

  Future<ApiResult<T>> _send<T>(
    Future<Response<Object?>> Function() call,
    Decode<T>? decode,
  ) async {
    final Response<Object?> response;
    try {
      response = await call();
    } on DioException catch (e) {
      return ApiResult.failure(ApiError.fromDio(e));
    }
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      return ApiResult.failure(ApiError.fromResponse(response));
    }
    if (decode == null) return ApiResult.success(response.data as T);
    try {
      return ApiResult.success(decode(response.data));
    } catch (e) {
      // A DTO the app cannot read is a bug to report, not a silent null.
      return ApiResult.failure(ApiError.unexpected('Cannot read response: $e'));
    }
  }

  /// Drops null query values, so `?cursor=` is not sent when there is none.
  static Map<String, dynamic>? _clean(Map<String, dynamic>? query) {
    if (query == null) return null;
    return {
      for (final e in query.entries)
        if (e.value != null) e.key: e.value,
    };
  }
}

/// Decoder helpers for repositories.
extension DecodeJson on Object? {
  Map<String, dynamic> get asMap => this! as Map<String, dynamic>;
  List<Object?> get asList => this! as List<Object?>;
}
