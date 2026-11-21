import '../helpers/constants.dart';
import '../helpers/shared_pref_helper.dart';
import '../models/auth_user.dart';
import 'session_cubit.dart';

/// Keeps the last signed-in user so the app opens offline. A fake in tests.
abstract class UserCache {
  Future<AuthUser?> read();
  Future<void> write(AuthUser user);
  Future<void> clear();
}

/// [UserCache] in the secure storage, next to the tokens.
class SecureUserCache implements UserCache {
  const SecureUserCache();

  @override
  Future<AuthUser?> read() async => AuthUserJson.decode(
    await SharedPrefHelper.getSecuredString(SharedPrefKeys.cachedUser),
  );

  @override
  Future<void> write(AuthUser user) => SharedPrefHelper.setSecuredString(
    SharedPrefKeys.cachedUser,
    user.encode(),
  );

  @override
  Future<void> clear() =>
      SharedPrefHelper.removeSecuredData(SharedPrefKeys.cachedUser);
}
