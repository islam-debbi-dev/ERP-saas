import 'package:flutter_bloc/flutter_bloc.dart';

import '../../features/account/data/repo/account_repository.dart';
import '../../features/auth/data/repo/auth_repository.dart';
import '../models/auth_user.dart';
import '../network/api_language.dart';
import '../network/auth_interceptor.dart';
import '../network/token_storage.dart';
import '../service/api_error_handler.dart';
import '../service/api_result.dart';
import 'session_state.dart';

/// Single source of truth for "guest or signed in", shared app-wide.
class SessionCubit extends Cubit<SessionState> {
  SessionCubit(this._auth, this._account)
    : super(const SessionState.unknown()) {
    // A refresh that fails mid-session (revoked / expired) drops to guest.
    AuthInterceptor.onSessionExpired = () {
      if (!isClosed && state.isAuthenticated) {
        emit(const SessionState.guest());
      }
    };
  }

  final AuthRepository _auth;
  final AccountRepository _account;

  AuthUser? get user => state.user;

  /// Splash: validates a stored token with `GET /auth/me`. An offline start
  /// keeps the tokens (so the session survives) but runs as guest for now.
  Future<void> restore() async {
    final token = await TokenStorage.readAccessToken();
    if (token.isEmpty) return emit(const SessionState.guest());

    final result = await _auth.me();
    switch (result) {
      case Success(:final data) when isCustomerRole(data.role):
        await _signedIn(data);
      case Success():
        await signOutLocally();
      case Failure():
        emit(const SessionState.guest());
    }
  }

  /// Returns the failure for the form to show, or `null` on success.
  Future<ErrorHandler?> login(String phone, String password) async =>
      _handle(await _auth.login(phone: phone, password: password));

  Future<ErrorHandler?> register({
    required String name,
    required String phone,
    required String password,
    String? email,
  }) async => _handle(
    await _auth.register(
      name: name,
      phone: phone,
      password: password,
      email: email,
      preferredLanguage: ApiLanguage.current,
    ),
  );

  /// Profile / address changes made elsewhere.
  void updateUser(AuthUser user) {
    if (state.isAuthenticated) emit(SessionState.authenticated(user));
  }

  /// Re-fetches `/me` (e.g. after adding an address).
  Future<void> refreshUser() async {
    if (!state.isAuthenticated) return;
    final result = await _account.getProfile();
    if (result case Success(:final data)) updateUser(data);
  }

  /// The backend localizes by the user's `preferredLanguage` before the
  /// `Accept-Language` header, so keep it in step with the app language.
  Future<void> syncLanguage(String appLanguageCode) async {
    final lang = ApiLanguage.fromLocaleCode(appLanguageCode);
    final current = state.user;
    if (current == null || current.preferredLanguage == lang) return;
    final result = await _account.updateProfile(preferredLanguage: lang);
    if (result case Success(:final data)) updateUser(data);
  }

  Future<void> logout() async {
    await _auth.logout();
    emit(const SessionState.guest());
  }

  /// Local sign-out after the server already revoked every session
  /// (password change / reset).
  Future<void> signOutLocally() async {
    await TokenStorage.clear();
    emit(const SessionState.guest());
  }

  void continueAsGuest() => emit(const SessionState.guest());

  /// Translation key surfaced when an admin account tries the client app.
  static const clientsOnlyError = 'jb.auth.clients_only';

  /// Roles allowed in the client app — the backend's `CUSTOMER_ROLES`. A store
  /// manager orders like any customer with the same account; admins use the
  /// dashboard only.
  static const customerRoles = {'client', 'store_manager'};

  static bool isCustomerRole(String role) => customerRoles.contains(role);

  Future<ErrorHandler?> _handle(ApiResult<AuthSession> result) async {
    if (result case Failure(:final message)) return message;
    final session = (result as Success<AuthSession>).data;
    // Admins can authenticate, but the client endpoints (`/orders`) only
    // accept customer roles.
    if (!isCustomerRole(session.user.role)) {
      await _auth.logout();
      return ErrorHandler.fromMessage(clientsOnlyError, code: '-403');
    }
    await _signedIn(session.user);
    return null;
  }

  Future<void> _signedIn(AuthUser user) async {
    emit(SessionState.authenticated(user));
    await syncLanguage(await ApiLanguage.resolve());
  }
}
