import '../models/auth_user.dart';

enum SessionStatus { unknown, guest, authenticated }

/// Who is using the app right now.
class SessionState {
  final SessionStatus status;
  final AuthUser? user;

  const SessionState._(this.status, this.user);

  const SessionState.unknown() : this._(SessionStatus.unknown, null);
  const SessionState.guest() : this._(SessionStatus.guest, null);
  const SessionState.authenticated(AuthUser user)
    : this._(SessionStatus.authenticated, user);

  bool get isAuthenticated => status == SessionStatus.authenticated;
  bool get isGuest => status == SessionStatus.guest;
}
