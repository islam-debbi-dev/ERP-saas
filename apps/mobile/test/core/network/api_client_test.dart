import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/core/network/auth_interceptor.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/core/service/dio_generate.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/memory_token_store.dart';

/// A Dio like the app's, on a fake adapter and an in-memory token store.
(Dio, FakeAdapter) _dio(
  FakeReply Function(RequestOptions o) handler,
  MemoryTokenStore store,
) {
  final adapter = FakeAdapter(handler);
  final dio = Dio(
    BaseOptions(
      baseUrl: 'https://api.test',
      headers: {DioGenerate.clientTypeHeader: DioGenerate.clientTypeNative},
    ),
  )..httpClientAdapter = adapter;
  dio.interceptors.add(AuthInterceptor(dio, store: store));
  return (dio, adapter);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'locale': 'fr'});
    AuthInterceptor.onSessionExpired = null;
  });

  test('sends the native client header, the token and the language', () async {
    final store = MemoryTokenStore(access: 'A1', refresh: 'R1');
    final (dio, adapter) = _dio(
      (_) => const FakeReply(200, {'ok': true}),
      store,
    );
    final result = await ApiClient(dio: dio).get<Object?>('/auth/me');
    expect(result, isA<Success<Object?>>());
    final h = adapter.sent.single.headers;
    expect(h['X-Client-Type'], 'native');
    expect(h['Authorization'], 'Bearer A1');
    expect(h['Accept-Language'], isIn(['ar', 'fr', 'en']));
  });

  test('decodes the DTO itself (no { data } envelope)', () async {
    final store = MemoryTokenStore(access: 'A1');
    final (dio, _) = _dio(
      (_) => const FakeReply(200, {'id': 'u1', 'fullName': 'Karim'}),
      store,
    );
    final result = await ApiClient(dio: dio).get<String>(
      '/auth/me',
      decode: (json) => json.asMap['fullName'] as String,
    );
    expect((result as Success<String>).data, 'Karim');
  });

  test('an API error becomes a Failure with the API code', () async {
    final (dio, _) = _dio(
      (_) => const FakeReply(422, {
        'code': 'CREDIT_LIMIT_EXCEEDED',
        'message': 'Plafond',
      }),
      MemoryTokenStore(access: 'A1'),
    );
    final result = await ApiClient(dio: dio).post<Object?>('/sales/quick');
    final error = (result as Failure<Object?>).error;
    expect(error.code, 'CREDIT_LIMIT_EXCEEDED');
  });

  test('a 401 refreshes once with { refreshToken } and replays', () async {
    final store = MemoryTokenStore(access: 'OLD', refresh: 'R1');
    var meCalls = 0;
    final (dio, adapter) = _dio((o) {
      if (o.path == '/auth/refresh') {
        return const FakeReply(200, {
          'accessToken': 'NEW',
          'refreshToken': 'R2',
          'expiresIn': 900,
        });
      }
      meCalls++;
      return o.headers['Authorization'] == 'Bearer NEW'
          ? const FakeReply(200, {'ok': true})
          : const FakeReply(401, {'code': 'TOKEN_EXPIRED', 'message': 'x'});
    }, store);

    final result = await ApiClient(dio: dio).get<Object?>('/clients');
    expect(result, isA<Success<Object?>>());
    expect(meCalls, 2);
    final refresh = adapter.sent.firstWhere((r) => r.path == '/auth/refresh');
    expect(refresh.body, {'refreshToken': 'R1'});
    expect(refresh.headers['X-Client-Type'], 'native');
    expect(store.access, 'NEW');
    expect(store.refresh, 'R2');
  });

  test('a rejected refresh clears the tokens and ends the session', () async {
    final store = MemoryTokenStore(access: 'OLD', refresh: 'R1');
    var expired = false;
    AuthInterceptor.onSessionExpired = () => expired = true;
    final (dio, _) = _dio(
      (o) => o.path == '/auth/refresh'
          ? const FakeReply(401, {'code': 'SESSION_REVOKED', 'message': 'x'})
          : const FakeReply(401, {'code': 'TOKEN_EXPIRED', 'message': 'x'}),
      store,
    );
    final result = await ApiClient(dio: dio).get<Object?>('/clients');
    expect(result, isA<Failure<Object?>>());
    expect(expired, isTrue);
    expect(store.clears, 1);
  });

  test('a refresh that cannot reach the API keeps the session', () async {
    final store = MemoryTokenStore(access: 'OLD', refresh: 'R1');
    var expired = false;
    AuthInterceptor.onSessionExpired = () => expired = true;
    final (dio, _) = _dio(
      (o) => o.path == '/auth/refresh'
          ? const FakeReply.fail(DioExceptionType.connectionError)
          : const FakeReply(401, {'code': 'TOKEN_EXPIRED', 'message': 'x'}),
      store,
    );
    await ApiClient(dio: dio).get<Object?>('/clients');
    expect(expired, isFalse);
    expect(store.refresh, 'R1');
  });

  test('a retry of the same action reuses its Idempotency-Key', () async {
    var calls = 0;
    final (dio, adapter) = _dio((_) {
      calls++;
      return calls == 1
          ? const FakeReply.fail(DioExceptionType.receiveTimeout)
          : const FakeReply(201, {'id': 'bl1'});
    }, MemoryTokenStore(access: 'A1'));
    final client = ApiClient(dio: dio);
    final key = IdempotencyKey(); // created when the form opens

    final first = await client.post<Object?>(
      '/sales/quick',
      idempotencyKey: key,
    );
    expect((first as Failure<Object?>).error.kind, ApiErrorKind.timeout);
    final retry = await client.post<Object?>(
      '/sales/quick',
      idempotencyKey: key,
    );
    expect(retry, isA<Success<Object?>>());

    final keys = adapter.sent.map((r) => r.headers['Idempotency-Key']).toList();
    expect(keys, [key.value, key.value]);

    key.renew(); // next sale from the same form
    expect(key.value, isNot(keys.first));
  });
}
