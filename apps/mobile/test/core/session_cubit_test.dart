import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/service/api_error_handler.dart';
import 'package:orvynt_starter/core/service/api_result.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/features/account/data/repo/account_repository.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

AuthUser _user(String role) =>
    AuthUser(id: 'u1', name: 'Test', phone: '+213555000301', role: role);

/// Answers login / `GET /auth/me` with a user of the given role.
class _FakeAuth implements AuthRepository {
  _FakeAuth(this.role);

  final String role;
  int logouts = 0;

  @override
  Future<ApiResult<AuthSession>> login({
    required String phone,
    required String password,
  }) async => ApiResult.success(
    AuthSession(accessToken: 'a', refreshToken: 'r', user: _user(role)),
  );

  @override
  Future<ApiResult<AuthUser>> me() async => ApiResult.success(_user(role));

  @override
  Future<void> logout() async => logouts++;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Language sync is not under test: it just fails quietly.
class _FakeAccount implements AccountRepository {
  @override
  Future<ApiResult<AuthUser>> updateProfile({
    String? name,
    String? email,
    String? preferredLanguage,
  }) async => ApiResult.failure(ErrorHandler.fromMessage('offline'));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({'userToken': 'stored-token'});
  });

  group('login', () {
    for (final role in ['client', 'store_manager']) {
      test('accepts $role', () async {
        final auth = _FakeAuth(role);
        final cubit = SessionCubit(auth, _FakeAccount());

        final error = await cubit.login('+213555000301', 'Jibli@2026');

        expect(error, isNull);
        expect(cubit.state.isAuthenticated, isTrue);
        expect(cubit.user?.role, role);
        expect(auth.logouts, 0);
        await cubit.close();
      });
    }

    test('refuses admin with clients_only and drops its session', () async {
      final auth = _FakeAuth('admin');
      final cubit = SessionCubit(auth, _FakeAccount());

      final error = await cubit.login('+213555000001', 'Jibli@2026');

      expect(error?.apiErrorModel.message, SessionCubit.clientsOnlyError);
      expect(cubit.state.isAuthenticated, isFalse);
      expect(auth.logouts, 1);
      await cubit.close();
    });
  });

  group('restore', () {
    for (final role in ['client', 'store_manager']) {
      test('keeps a stored $role session', () async {
        final cubit = SessionCubit(_FakeAuth(role), _FakeAccount());
        await cubit.restore();
        expect(cubit.state.isAuthenticated, isTrue);
        expect(cubit.user?.role, role);
        await cubit.close();
      });
    }

    test('signs a stored admin session out', () async {
      final cubit = SessionCubit(_FakeAuth('admin'), _FakeAccount());
      await cubit.restore();
      expect(cubit.state.isAuthenticated, isFalse);
      await cubit.close();
    });
  });

  group('AuthUser store fields', () {
    test('reads the store name from GET /me', () {
      final user = AuthUser.fromJson({
        'id': 'u1',
        'name': 'Manager',
        'phone': '+213555000301',
        'role': 'store_manager',
        'storeId': 's1',
        'store': {
          'id': 's1',
          'name': {'ar': 'سوق النور', 'en': 'Al Nour market'},
        },
      });
      expect(user.isStoreManager, isTrue);
      expect(user.storeId, 's1');
      expect(user.storeName, isNotEmpty);
      // A cached copy round-trips.
      expect(AuthUser.fromJson(user.toJson()).storeName, user.storeName);
    });

    test('a client has no store', () {
      final user = AuthUser.fromJson({'id': 'u2', 'name': 'C', 'phone': 'p'});
      expect(user.isStoreManager, isFalse);
      expect(user.storeName, isNull);
    });
  });
}
