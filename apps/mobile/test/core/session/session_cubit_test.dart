import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/core/network/auth_interceptor.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/session/session_state.dart';
import 'package:orvynt_starter/core/session/user_cache.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';

AuthUser user(
  String role, {
  List<String> features = const ['MOBILE_APP'],
  bool mustChangePassword = false,
}) => AuthUser(
  id: 'u-$role',
  fullName: 'User $role',
  role: role,
  tenantId: 't1',
  tenantName: 'Grossiste Demo',
  edition: 'DISTRIBUTION',
  features: features,
  mustChangePassword: mustChangePassword,
);

ApiResult<AuthSession> session(AuthUser u) => ApiResult.success(
  AuthSession(accessToken: 'a', refreshToken: 'r', expiresIn: 900, user: u),
);

ApiError serverError(String code) =>
    ApiError(kind: ApiErrorKind.server, code: code, message: code);

class FakeAuth extends AuthRepository {
  FakeAuth() : super(ApiClient(dio: Dio()));

  bool stored = true;
  ApiResult<AuthUser>? meResult;
  ApiResult<AuthSession>? loginResult;
  ApiResult<AuthUser>? passwordResult;
  String? lastDeviceName;
  int logouts = 0;
  int localClears = 0;

  @override
  Future<bool> hasStoredSession() async => stored;

  @override
  Future<ApiResult<AuthUser>> me() async => meResult!;

  @override
  Future<ApiResult<AuthSession>> login({
    required String identifier,
    required String password,
    required String deviceName,
  }) async {
    lastDeviceName = deviceName;
    return loginResult!;
  }

  @override
  Future<ApiResult<AuthUser>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async => passwordResult!;

  @override
  Future<void> logout() async => logouts++;

  @override
  Future<void> clearLocal() async => localClears++;
}

class MemoryUserCache implements UserCache {
  AuthUser? value;

  @override
  Future<AuthUser?> read() async => value;

  @override
  Future<void> write(AuthUser user) async => value = user;

  @override
  Future<void> clear() async => value = null;
}

void main() {
  late FakeAuth auth;
  late MemoryUserCache cache;
  late SessionCubit cubit;

  setUp(() {
    auth = FakeAuth();
    cache = MemoryUserCache();
    cubit = SessionCubit(
      auth,
      cache: cache,
      deviceName: () async => 'Pixel 7 · Debvora 1.1.0',
    );
  });

  tearDown(() => cubit.close());

  group('restore', () {
    test('no stored session → login', () async {
      auth.stored = false;
      await cubit.restore();
      expect(cubit.state.status, SessionStatus.signedOut);
    });

    test('a valid session of a seller → signed in, user cached', () async {
      auth.meResult = ApiResult.success(user('SELLER'));
      await cubit.restore();
      expect(cubit.state.status, SessionStatus.signedIn);
      expect(cache.value?.role, 'SELLER');
    });

    test('offline start uses the last known user', () async {
      cache.value = user('LIVREUR');
      auth.meResult = ApiResult.failure(ApiError.local(ApiErrorKind.offline));
      await cubit.restore();
      expect(cubit.state.status, SessionStatus.signedIn);
      expect(cubit.state.user?.role, 'LIVREUR');
      expect(auth.logouts, 0);
    });

    test('offline start without a cached user → login', () async {
      auth.meResult = ApiResult.failure(ApiError.local(ApiErrorKind.timeout));
      await cubit.restore();
      expect(cubit.state.status, SessionStatus.signedOut);
    });

    test('a session the API rejects → login, tokens cleared', () async {
      auth.meResult = ApiResult.failure(serverError('SESSION_REVOKED'));
      await cubit.restore();
      expect(cubit.state.status, SessionStatus.signedOut);
      expect(auth.localClears, 1);
    });
  });

  group('login', () {
    for (final role in ['SELLER', 'LIVREUR', 'SUPERVISOR', 'STOREKEEPER']) {
      test('$role signs in', () async {
        auth.loginResult = session(user(role));
        final error = await cubit.login('0555000001', 'secret123');
        expect(error, isNull);
        expect(cubit.state.status, SessionStatus.signedIn);
        expect(auth.lastDeviceName, 'Pixel 7 · Debvora 1.1.0');
      });
    }

    for (final role in ['OWNER', 'MANAGER']) {
      test('$role is refused and the session closed', () async {
        auth.loginResult = session(user(role));
        await cubit.login('owner@demo.dz', 'secret123');
        expect(cubit.state.status, SessionStatus.refused);
        expect(cubit.state.refusal, Refusal.officeRole);
        expect(auth.logouts, 1);
        expect(cache.value, isNull);
      });
    }

    test('a tenant without MOBILE_APP is refused', () async {
      auth.loginResult = session(user('STOREKEEPER', features: const []));
      await cubit.login('mag@demo.dz', 'secret123');
      expect(cubit.state.refusal, Refusal.noMobileApp);
      expect(auth.logouts, 1);
    });

    test('FEATURE_NOT_IN_PLAN from the API shows the same refusal', () async {
      auth.loginResult = ApiResult.failure(serverError('FEATURE_NOT_IN_PLAN'));
      final error = await cubit.login('0555000001', 'secret123');
      expect(error, isNull);
      expect(cubit.state.refusal, Refusal.noMobileApp);
    });

    test('MOBILE_SELLER_LIMIT is returned to the form', () async {
      cubit.backToLogin();
      auth.loginResult = ApiResult.failure(serverError('MOBILE_SELLER_LIMIT'));
      final error = await cubit.login('0555000003', 'secret123');
      expect(error?.code, 'MOBILE_SELLER_LIMIT');
      expect(cubit.state.status, SessionStatus.signedOut);
    });

    test('wrong password is returned to the form', () async {
      auth.loginResult = ApiResult.failure(serverError('INVALID_CREDENTIALS'));
      final error = await cubit.login('0555000001', 'nope');
      expect(error?.code, 'INVALID_CREDENTIALS');
    });
  });

  group('temporary password', () {
    test('goes to the forced change, then signs in', () async {
      auth.loginResult = session(user('SELLER', mustChangePassword: true));
      await cubit.login('0555000001', 'temp1234');
      expect(cubit.state.status, SessionStatus.mustChangePassword);

      auth.passwordResult = ApiResult.success(user('SELLER'));
      final error = await cubit.changePassword('temp1234', 'newpass123');
      expect(error, isNull);
      expect(cubit.state.status, SessionStatus.signedIn);
    });

    test('a wrong current password stays on the form', () async {
      auth.loginResult = session(user('SELLER', mustChangePassword: true));
      await cubit.login('0555000001', 'temp1234');
      auth.passwordResult = ApiResult.failure(
        serverError('INVALID_CREDENTIALS'),
      );
      final error = await cubit.changePassword('wrong', 'newpass123');
      expect(error?.code, 'INVALID_CREDENTIALS');
      expect(cubit.state.status, SessionStatus.mustChangePassword);
    });
  });

  test('a rejected refresh mid-session goes back to login', () async {
    auth.loginResult = session(user('SELLER'));
    await cubit.login('0555000001', 'secret123');
    AuthInterceptor.onSessionExpired!();
    await Future<void>.delayed(Duration.zero);
    expect(cubit.state.status, SessionStatus.signedOut);
    expect(cache.value, isNull);
  });

  test('logout closes the session and clears the cache', () async {
    auth.loginResult = session(user('SUPERVISOR'));
    await cubit.login('sup@demo.dz', 'secret123');
    await cubit.logout();
    expect(auth.logouts, 1);
    expect(cubit.state.status, SessionStatus.signedOut);
    expect(cache.value, isNull);
  });
}
