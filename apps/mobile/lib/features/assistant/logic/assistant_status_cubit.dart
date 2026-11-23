import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/models/auth_user.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/session/session_state.dart';
import '../data/assistant_models.dart';
import '../data/assistant_repository.dart';

/// Whether the assistant entry shows, from `GET /assistant/status`.
///
/// Read once per signed-in user (again when the user or his AI_ASSISTANT
/// flag changes), not on every visit of "Plus". Without the flag no call is
/// made. A failed call hides the entry until the next sign-in or app start:
/// the API decides, the phone never guesses `available`.
class AssistantStatusCubit extends Cubit<AssistantStatus> {
  AssistantStatusCubit(this._repo, SessionCubit session)
    : super(AssistantStatus.unavailable) {
    _onSession(session.state);
    _sub = session.stream.listen(_onSession);
  }

  /// A fixed status (widget tests).
  AssistantStatusCubit.seeded(super.status) : _repo = null;

  final AssistantRepository? _repo;
  StreamSubscription<SessionState>? _sub;

  /// `userId|flag` of the last read, so a refreshed `/auth/me` with the same
  /// user does not read the status again.
  String? _readFor;
  int _generation = 0;

  void _onSession(SessionState session) {
    final user = session.isSignedIn ? session.user : null;
    final key = user == null ? null : _keyOf(user);
    if (key == _readFor) return;
    _readFor = key;
    _generation++;
    emit(AssistantStatus.unavailable);
    if (user != null && user.hasFeature(Feature.aiAssistant)) {
      unawaited(_read(_generation));
    }
  }

  static String _keyOf(AuthUser user) =>
      '${user.id}|${user.hasFeature(Feature.aiAssistant)}';

  Future<void> _read(int generation) async {
    final result = await _repo!.status();
    if (isClosed || generation != _generation) return;
    switch (result) {
      case Success(:final data):
        emit(data);
      case Failure():
        emit(AssistantStatus.unavailable);
    }
  }

  @override
  Future<void> close() async {
    await _sub?.cancel();
    return super.close();
  }
}
