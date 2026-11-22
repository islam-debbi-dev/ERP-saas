import 'api_error.dart';
import 'api_result.dart';
import 'idempotency_key.dart';

/// Sends one money / stock action (sale, versement, visit, order...) with the
/// form's [IdempotencyKey], and handles GEO_NOTE_REQUIRED: the user types the
/// note and the **same** request goes again with the **same key** and the
/// same position (the API released the key when it refused). A retry after a
/// timeout is the caller calling [run] again with the same key: the API
/// replays the first answer, so one tap never makes two documents.
///
/// Errors are returned, never swallowed: the screen shows them.
class MoneyActionRunner {
  const MoneyActionRunner({required this.askGeoNote});

  /// Asks the user why the position is off; null = he gave up.
  final Future<String?> Function(ApiError error) askGeoNote;

  /// At most this many notes are asked for one action.
  static const maxNotes = 2;

  Future<ApiResult<T>> run<T>(
    IdempotencyKey key,
    Future<ApiResult<T>> Function(IdempotencyKey key, String? geoNote) send, {
    String? geoNote,
  }) async {
    var note = geoNote;
    var result = await send(key, note);
    for (var i = 0; i < maxNotes; i++) {
      if (result case Failure(
        :final error,
      ) when error.code == 'GEO_NOTE_REQUIRED') {
        final typed = await askGeoNote(error);
        if (typed == null || typed.trim().isEmpty) return result;
        note = typed.trim();
        result = await send(key, note);
      } else {
        break;
      }
    }
    return result;
  }
}
