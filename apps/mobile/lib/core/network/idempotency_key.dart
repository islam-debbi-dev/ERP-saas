import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';

/// The `Idempotency-Key` of one user action (AGENTS §3 rule 6).
///
/// Create it **when the form opens** and keep it in the form's state: every
/// retry of the same action (timeout, double tap, GEO_NOTE_REQUIRED resend)
/// sends the same key, so the API replays the first answer instead of making
/// a second BL or versement. Call [renew] only after a success, when the form
/// is reused for a new action.
class IdempotencyKey {
  IdempotencyKey([String? value]) : _value = value ?? _uuid.v4();

  static const header = 'Idempotency-Key';
  static const _uuid = Uuid();

  String _value;
  String get value => _value;

  /// A new key for the next action of the same form.
  void renew() => _value = _uuid.v4();

  /// Request options carrying the key.
  Options get options => Options(headers: {header: _value});

  Map<String, String> get headers => {header: _value};

  @override
  String toString() => _value;
}
