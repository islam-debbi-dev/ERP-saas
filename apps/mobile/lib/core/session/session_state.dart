import '../models/auth_user.dart';

enum SessionStatus {
  /// The splash is still checking the stored session.
  unknown,

  /// No session: show the login screen.
  signedOut,

  /// Signed in with a temporary password: only the change-password screen.
  mustChangePassword,

  /// Signed in and allowed: the role's screens.
  signedIn,

  /// Authenticated but not allowed in the app (see [Refusal]).
  refused,
}

/// Why an authenticated user cannot use the app. The session is closed on the
/// API when this happens; the screen explains and offers the dashboard link.
enum Refusal {
  /// OWNER / MANAGER: they work on the web dashboard.
  officeRole,

  /// The tenant's edition has no MOBILE_APP module.
  noMobileApp,
}

/// Who is using the app right now.
class SessionState {
  const SessionState._(this.status, {this.user, this.refusal});

  const SessionState.unknown() : this._(SessionStatus.unknown);
  const SessionState.signedOut() : this._(SessionStatus.signedOut);
  const SessionState.signedIn(AuthUser user)
    : this._(SessionStatus.signedIn, user: user);
  const SessionState.mustChangePassword(AuthUser user)
    : this._(SessionStatus.mustChangePassword, user: user);
  const SessionState.refused(Refusal refusal)
    : this._(SessionStatus.refused, refusal: refusal);

  final SessionStatus status;
  final AuthUser? user;
  final Refusal? refusal;

  bool get isSignedIn => status == SessionStatus.signedIn;
  bool get isSignedOut => status == SessionStatus.signedOut;

  @override
  String toString() => 'SessionState($status, ${user?.role}, $refusal)';
}
