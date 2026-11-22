import 'package:dio/dio.dart';

/// Why a request failed. [server] means the API answered with an error body;
/// the other kinds never reached it (or never came back).
enum ApiErrorKind { server, offline, timeout, cancelled, unknown }

/// A failed API call, mirroring the API's error body `{ code, message, details? }`
/// (`packages/shared/src/errors.ts`). There is no envelope: the body is the
/// error itself.
///
/// For a [ApiErrorKind.server] error [code] is the API's `ErrorCode` (e.g.
/// `CREDIT_LIMIT_EXCEEDED`); for local failures it is the kind's name.
/// Screens show it through `apiErrorText` (translated by code, else the API's
/// [message]); never swallow it on a money action.
class ApiError implements Exception {
  const ApiError({
    required this.kind,
    required this.code,
    this.message = '',
    this.details,
    this.statusCode,
  });

  final ApiErrorKind kind;
  final String code;

  /// The API's message (in the request's `Accept-Language` when it has one).
  final String message;

  /// The API's `details` (an object or a list, shape depends on the code).
  final Object? details;
  final int? statusCode;

  bool get isOffline =>
      kind == ApiErrorKind.offline || kind == ApiErrorKind.timeout;

  /// Reads one field of [details] when it is an object, e.g. `limit`.
  Object? detail(String key) {
    final d = details;
    return d is Map ? d[key] : null;
  }

  factory ApiError.local(ApiErrorKind kind, [String message = '']) =>
      ApiError(kind: kind, code: kind.name, message: message);

  /// A response the app could not decode (wrong shape, bad JSON).
  factory ApiError.unexpected([String message = 'Unexpected response']) =>
      ApiError.local(ApiErrorKind.unknown, message);

  /// Maps a Dio failure. A response with a body becomes a [ApiErrorKind.server]
  /// error with the API's code; network problems become local kinds.
  factory ApiError.fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiError.local(ApiErrorKind.timeout);
      case DioExceptionType.connectionError:
        return ApiError.local(ApiErrorKind.offline);
      case DioExceptionType.cancel:
        return ApiError.local(ApiErrorKind.cancelled);
      case DioExceptionType.badCertificate:
        return ApiError.local(ApiErrorKind.unknown, 'Bad certificate');
      case DioExceptionType.badResponse:
      case DioExceptionType.unknown:
        final response = e.response;
        if (response != null) return ApiError.fromResponse(response);
        return ApiError.local(ApiErrorKind.unknown, e.message ?? '');
    }
  }

  /// Decodes a non-2xx response body `{ code, message, details? }`.
  factory ApiError.fromResponse(Response<dynamic> response) {
    final body = response.data;
    final status = response.statusCode;
    if (body is Map && body['code'] is String) {
      return ApiError(
        kind: ApiErrorKind.server,
        code: body['code'] as String,
        message: body['message']?.toString() ?? '',
        details: body['details'],
        statusCode: status,
      );
    }
    // A proxy or platform error page (502 from Vercel...): no API code.
    return ApiError(
      kind: ApiErrorKind.server,
      code: status != null && status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN',
      message: body is String ? body : '',
      statusCode: status,
    );
  }

  @override
  String toString() => 'ApiError($code, $statusCode): $message';
}
