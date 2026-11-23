import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../team/logic/team_cubits.dart' show noGeoRunner;
import '../data/stock_transfers_repository.dart';
import '../data/transfer_models.dart';

class TransferCancelState {
  const TransferCancelState({this.busy = false, this.error, this.result});

  final bool busy;
  final ApiError? error;

  /// The cancelled transfer (and, in WARN mode, the dépôts left negative).
  final TransferResult? result;
}

/// *Annuler* a transfer with a reason (`POST /stock-transfers/:id/cancel`):
/// a draft is abandoned, a validated one has its goods moved back. Nothing
/// is ever deleted.
///
/// One Idempotency-Key per (transfer, reason): a retry of the same reason
/// after a timeout or a double tap replays the first answer; another reason
/// is another action, and the API refuses a second cancel
/// (TRANSFER_NOT_VALIDATED), so goods never move back twice.
class TransferCancelCubit extends Cubit<TransferCancelState> {
  TransferCancelCubit(this._repo, {required this.transferId})
    : super(const TransferCancelState());

  final StockTransfersRepository _repo;
  final String transferId;

  /// The API's minimum (`cancelStockTransferSchema`).
  static const minReason = 3;

  String? _reason;
  IdempotencyKey _key = IdempotencyKey();

  IdempotencyKey keyFor(String reason) {
    if (_reason != reason) {
      _reason = reason;
      _key = IdempotencyKey();
    }
    return _key;
  }

  Future<bool> cancel(String reason) async {
    final r = reason.trim();
    if (state.busy || r.length < minReason) return false;
    emit(const TransferCancelState(busy: true));
    final key = keyFor(r);
    final result = await noGeoRunner.run(
      key,
      (k, _) => _repo.cancel(transferId, reason: r, key: k),
    );
    if (isClosed) return false;
    switch (result) {
      case Failure(:final error):
        emit(TransferCancelState(error: error));
        return false;
      case Success(:final data):
        emit(TransferCancelState(result: data));
        return true;
    }
  }
}
