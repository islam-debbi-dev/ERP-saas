import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/error_messages.dart';

Response<dynamic> _res(int status, Object? body) => Response<dynamic>(
  requestOptions: RequestOptions(path: '/x'),
  statusCode: status,
  data: body,
);

void main() {
  group('ApiError.fromResponse', () {
    test('reads the API body { code, message, details } with no envelope', () {
      final e = ApiError.fromResponse(
        _res(422, {
          'code': 'CREDIT_LIMIT_EXCEEDED',
          'message': 'Plafond dépassé',
          'details': {'limit': '50000.00'},
        }),
      );
      expect(e.kind, ApiErrorKind.server);
      expect(e.code, 'CREDIT_LIMIT_EXCEEDED');
      expect(e.message, 'Plafond dépassé');
      expect(e.detail('limit'), '50000.00');
      expect(e.statusCode, 422);
    });

    test('a platform error page without a code is an internal error', () {
      final e = ApiError.fromResponse(_res(502, '<html>Bad gateway</html>'));
      expect(e.code, 'INTERNAL_ERROR');
      expect(e.kind, ApiErrorKind.server);
    });
  });

  group('ApiError.fromDio', () {
    DioException ex(DioExceptionType t) => DioException(
      requestOptions: RequestOptions(path: '/x'),
      type: t,
    );

    test('network failures become local kinds', () {
      expect(
        ApiError.fromDio(ex(DioExceptionType.connectionError)).kind,
        ApiErrorKind.offline,
      );
      expect(
        ApiError.fromDio(ex(DioExceptionType.receiveTimeout)).kind,
        ApiErrorKind.timeout,
      );
      expect(
        ApiError.fromDio(ex(DioExceptionType.cancel)).kind,
        ApiErrorKind.cancelled,
      );
      expect(
        ApiError.fromDio(ex(DioExceptionType.sendTimeout)).isOffline,
        true,
      );
    });

    test('a bad response keeps the API code', () {
      final e = ApiError.fromDio(
        DioException.badResponse(
          statusCode: 409,
          requestOptions: RequestOptions(path: '/x'),
          response: _res(409, {'code': 'STOCK_INSUFFICIENT', 'message': 'm'}),
        ),
      );
      expect(e.code, 'STOCK_INSUFFICIENT');
    });
  });

  group('ErrorMessages.keyFor', () {
    test('field codes map to their translated key', () {
      for (final code in [
        'CREDIT_LIMIT_EXCEEDED',
        'STOCK_INSUFFICIENT',
        'GEO_NOTE_REQUIRED',
        'GEO_TOO_FAR',
        'PASSWORD_CHANGE_REQUIRED',
        'FEATURE_NOT_IN_PLAN',
        'MOBILE_SELLER_LIMIT',
        'FORBIDDEN',
      ]) {
        final e = ApiError(kind: ApiErrorKind.server, code: code);
        expect(ErrorMessages.keyFor(e), 'errors.$code');
      }
    });

    test('an unknown code shows the API message', () {
      const e = ApiError(
        kind: ApiErrorKind.server,
        code: 'SOMETHING_NEW',
        message: 'Le message du serveur',
      );
      expect(ErrorMessages.keyFor(e), isNull);
    });

    test('an unknown code without message falls back to errors.unknown', () {
      const e = ApiError(kind: ApiErrorKind.server, code: 'SOMETHING_NEW');
      expect(ErrorMessages.keyFor(e), 'errors.unknown');
    });

    test('offline and timeout have their own keys', () {
      expect(
        ErrorMessages.keyFor(ApiError.local(ApiErrorKind.offline)),
        'errors.offline',
      );
      expect(
        ErrorMessages.keyFor(ApiError.local(ApiErrorKind.timeout)),
        'errors.timeout',
      );
    });

    testWidgets('apiErrorText falls back to the message', (tester) async {
      late String text;
      await tester.pumpWidget(
        Builder(
          builder: (context) {
            text = apiErrorText(
              context,
              const ApiError(
                kind: ApiErrorKind.server,
                code: 'NEW_CODE',
                message: 'Serveur',
              ),
            );
            return const SizedBox();
          },
        ),
      );
      expect(text, 'Serveur');
    });
  });
}
