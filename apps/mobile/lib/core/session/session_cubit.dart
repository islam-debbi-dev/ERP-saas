import 'dart:convert';

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../features/auth/data/repo/auth_repository.dart';
import '../helpers/device_and_platform.dart';
import '../models/auth_user.dart';
import '../models/erp_codes.dart';
import '../network/api_error.dart';
import '../network/api_result.dart';
import '../network/auth_interceptor.dart';
import '../router/tab_badges.dart';
import 'session_state.dart';
import 'user_cache.dart';

/// Single source of truth for who is signed in, shared app-wide.
///
/// The app never decides a right the API does not enforce: it reads the role,
/// permissions and features of `GET /auth/me` to choose the screens, and the
/// API refuses anything else anyway.
class SessionCubit extends Cubit<SessionState> {
  SessionCubit(
    this._auth, {
    UserCache? cache,
    Future<String> Function()? deviceName,
  }) : _cache = cache ?? const SecureUserCache(),
       _deviceName = deviceName ?? DeviceHelper.deviceName,
       super(const SessionState.unknown()) {
    // The API rejected the refresh token (revoked from the web, expired,
    // reused): back to login.
    AuthInterceptor.onSessionExpired = () {
      if (isClosed) return;
      _cache.clear();
      emit(const SessionState.signedOut());
    };
  }

  final AuthRepository _auth;
  final UserCache _cache;
  final Future<String> Function() _deviceName;

  AuthUser? get user => state.user;

  /// Splash: checks the stored session with `GET /auth/me`. Offline, the last
  /// known user is used so a seller can open the app without network (the
  /// offline banner shows; every call still goes to the API).
  Future<void> restore() async {
    if (!await _auth.hasStoredSession()) {
      return emit(const SessionState.signedOut());
    }
    switch (await _auth.me()) {
      case Success(:final data):
        await _evaluate(data);
      case Failure(:final error) when error.isOffline:
        final cached = await _cache.read();
        if (cached == null) return emit(const SessionState.signedOut());
        await _evaluate(cached, online: false);
      case Failure():
        await _signOutLocally();
    }
  }

  /// Returns the error for the login form, or null when the login went
  /// through (the state then tells where to go: role home, password change
  /// or a refusal screen).
  Future<ApiError?> login(String identifier, String password) async {
    final result = await _auth.login(
      identifier: identifier,
      password: password,
      deviceName: await _deviceName(),
    );
    switch (result) {
      case Success(:final data):
        await _evaluate(data.user);
        return null;
      case Failure(:final error) when error.code == 'FEATURE_NOT_IN_PLAN':
        // A1: the API refuses a road role whose tenant has no MOBILE_APP.
        emit(const SessionState.refused(Refusal.noMobileApp));
        return null;
      case Failure(:final error):
        return error;
    }
  }

  /// Forced (or voluntary) password change. Returns the error to show, or
  /// null when done.
  Future<ApiError?> changePassword(String current, String next) async {
    final result = await _auth.changePassword(
      currentPassword: current,
      newPassword: next,
    );
    switch (result) {
      case Success(:final data):
        await _evaluate(data);
        return null;
      case Failure(:final error):
        return error;
    }
  }

  /// Re-reads `GET /auth/me` (a permission or feature changed on the web).
  Future<void> refreshUser() async {
    if (state.user == null) return;
    if (await _auth.me() case Success(:final data)) await _evaluate(data);
  }

  Future<void> logout() async {
    await _auth.logout();
    await _cache.clear();
    TabBadges.reset();
    emit(const SessionState.signedOut());
  }

  /// From a refusal screen back to the login form.
  void backToLogin() => emit(const SessionState.signedOut());

  /// Which state [user] leads to. Office roles and tenants without the mobile
  /// module are refused, and their session is closed on the API (it would
  /// otherwise hold a mobile seat for nothing).
  Future<void> _evaluate(AuthUser user, {bool online = true}) async {
    final refusal = refusalFor(user);
    if (refusal != null) {
      if (online) await _auth.logout();
      await _cache.clear();
      return emit(SessionState.refused(refusal));
    }
    await _cache.write(user);
    emit(
      user.mustChangePassword
          ? SessionState.mustChangePassword(user)
          : SessionState.signedIn(user),
    );
  }

  Future<void> _signOutLocally() async {
    await _auth.clearLocal();
    await _cache.clear();
    emit(const SessionState.signedOut());
  }

  /// Null when [user] may use the app.
  static Refusal? refusalFor(AuthUser user) {
    if (!Role.fieldRoles.contains(user.role)) return Refusal.officeRole;
    if (!user.hasFeature(Feature.mobileApp)) return Refusal.noMobileApp;
    return null;
  }
}

/// Last `GET /auth/me` answer, for an offline start.
extension AuthUserJson on AuthUser {
  String encode() => jsonEncode(toJson());
  static AuthUser? decode(String raw) {
    if (raw.isEmpty) return null;
    try {
      return AuthUser.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }
}
