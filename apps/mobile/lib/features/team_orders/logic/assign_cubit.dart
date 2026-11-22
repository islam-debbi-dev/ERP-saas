import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../orders/data/models/order.dart';
import '../data/team_orders_repository.dart';

class AssignState {
  const AssignState({
    this.options,
    this.loading = true,
    this.loadError,
    this.busyId,
    this.error,
  });

  final AssignOptions? options;
  final bool loading;
  final ApiError? loadError;

  /// The truck or person being saved.
  final String? busyId;

  /// The last refusal (ORDER_NOT_CONFIRMED, a truck out of reach...).
  final ApiError? error;
}

/// Puts one confirmed order on a delivery truck or on a deliverer.
/// `PATCH /orders/:id/livreur` sets a value, so a retry is harmless.
class AssignCubit extends Cubit<AssignState> {
  AssignCubit(this._repo, {required this.order}) : super(const AssignState());

  final TeamOrdersRepository _repo;
  final OrderSummary order;

  Future<void> load() async {
    emit(const AssignState());
    final r = await _repo.options();
    if (isClosed) return;
    switch (r) {
      case Success(:final data):
        emit(AssignState(options: data, loading: false));
      case Failure(:final error):
        emit(AssignState(loading: false, loadError: error));
    }
  }

  Future<Order?> _run(
    String id,
    Future<ApiResult<Order>> Function() send,
  ) async {
    if (state.busyId != null) return null;
    emit(AssignState(options: state.options, loading: false, busyId: id));
    final r = await send();
    if (isClosed) return null;
    switch (r) {
      case Success(:final data):
        emit(AssignState(options: state.options, loading: false));
        return data;
      case Failure(:final error):
        emit(AssignState(options: state.options, loading: false, error: error));
        return null;
    }
  }

  Future<Order?> toTruck(String truckId) =>
      _run(truckId, () => _repo.assignToTruck(order.id, truckId));

  Future<Order?> toPerson(String userId) =>
      _run(userId, () => _repo.assignToPerson(order.id, userId));
}
