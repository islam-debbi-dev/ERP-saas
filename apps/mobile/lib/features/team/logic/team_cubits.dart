import 'package:decimal/decimal.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../../core/network/money_action.dart';
import '../data/team_models.dart';
import '../data/team_repository.dart';

/// No GEO on these calls: the runner only brings its retry rule (same key).
final noGeoRunner = MoneyActionRunner(askGeoNote: (_) async => null);

// ------------------------------------------------------------------ member

class MemberDayState {
  const MemberDayState({
    this.data,
    this.loading = true,
    this.loadError,
    this.opening = false,
    this.error,
  });

  final MemberDay? data;
  final bool loading;
  final ApiError? loadError;
  final bool opening;

  /// The last refused action (open), shown above the day.
  final ApiError? error;

  MemberDayState copyWith({
    MemberDay? data,
    bool? loading,
    ApiError? loadError,
    bool clearLoadError = false,
    bool? opening,
    ApiError? error,
    bool clearError = false,
  }) => MemberDayState(
    data: data ?? this.data,
    loading: loading ?? this.loading,
    loadError: clearLoadError ? null : (loadError ?? this.loadError),
    opening: opening ?? this.opening,
    error: clearError ? null : (error ?? this.error),
  );
}

/// One member's day. "Ouvrir la journée" keeps its [openKey] across a
/// timeout retry and a double tap; it is renewed after a success.
class MemberDayCubit extends Cubit<MemberDayState> {
  MemberDayCubit(this._repo, {required this.sellerId, required this.date})
    : super(const MemberDayState());

  final TeamRepository _repo;
  final String sellerId;
  final String date;
  final IdempotencyKey openKey = IdempotencyKey();

  Future<void> load() async {
    emit(state.copyWith(loading: true, clearLoadError: true));
    final result = await _repo.member(sellerId, date);
    if (isClosed) return;
    switch (result) {
      case Success(:final data):
        emit(state.copyWith(data: data, loading: false));
      case Failure(:final error):
        emit(state.copyWith(loading: false, loadError: error));
    }
  }

  Future<bool> openDay() async {
    if (state.opening || state.data?.day == null) return false;
    emit(state.copyWith(opening: true, clearError: true));
    final result = await noGeoRunner.run(
      openKey,
      (k, _) => _repo.open(sellerId, date, k),
    );
    if (isClosed) return false;
    switch (result) {
      case Failure(:final error):
        emit(state.copyWith(opening: false, error: error));
        return false;
      case Success():
        openKey.renew();
        emit(state.copyWith(opening: false));
        await load();
        return true;
    }
  }
}

// ------------------------------------------------------------------ clôture

enum CashFormMode { close, adjust }

class CashFormState {
  const CashFormState({
    this.handed,
    this.note = '',
    this.showErrors = false,
    this.submitting = false,
    this.error,
    this.closed,
    this.adjusted,
  });

  /// The cash counted; null = nothing typed.
  final Decimal? handed;
  final String note;
  final bool showErrors;
  final bool submitting;
  final ApiError? error;

  /// The server's answer to a close.
  final SessionCloseResult? closed;

  /// The server's answer to a correction.
  final SellerSession? adjusted;

  bool get done => closed != null || adjusted != null;

  CashFormState copyWith({
    Decimal? handed,
    bool clearHanded = false,
    String? note,
    bool? showErrors,
    bool? submitting,
    ApiError? error,
    bool clearError = false,
    SessionCloseResult? closed,
    SellerSession? adjusted,
  }) => CashFormState(
    handed: clearHanded ? null : (handed ?? this.handed),
    note: note ?? this.note,
    showErrors: showErrors ?? this.showErrors,
    submitting: submitting ?? this.submitting,
    error: clearError ? null : (error ?? this.error),
    closed: closed ?? this.closed,
    adjusted: adjusted ?? this.adjusted,
  );
}

/// Closing a day with the cash handed, or correcting a closed one.
///
/// The [key] is made when the form opens and kept across retries, so a
/// timeout then a second tap closes the day once.
class CashFormCubit extends Cubit<CashFormState> {
  CashFormCubit(
    this._repo, {
    required this.mode,
    required this.session,
    required this.expected,
  }) : super(const CashFormState());

  final TeamRepository _repo;
  final CashFormMode mode;
  final SellerSession session;

  /// The live expected cash the écart is previewed against.
  final Decimal expected;
  final IdempotencyKey key = IdempotencyKey();

  /// Minimum note of a correction (`reason` in the shared schemas).
  static const minNote = 3;

  void setHanded(Decimal? v) =>
      emit(state.copyWith(handed: v, clearHanded: v == null, clearError: true));

  void setNote(String v) => emit(state.copyWith(note: v, clearError: true));

  /// handed − expected, the server's rule; null until a count is typed.
  Decimal? get ecartPreview =>
      state.handed == null ? null : state.handed! - expected;

  List<String> get errors => [
    if (mode == CashFormMode.close &&
        (state.handed == null || state.handed! < Decimal.zero))
      'team.error_handed',
    if (mode == CashFormMode.adjust &&
        state.handed != null &&
        state.handed! < Decimal.zero)
      'team.error_handed',
    if (mode == CashFormMode.adjust && state.note.trim().length < minNote)
      'team.error_note',
  ];

  bool validate() {
    if (errors.isEmpty) return true;
    emit(state.copyWith(showErrors: true));
    return false;
  }

  Future<bool> submit() async {
    if (state.submitting || state.done || !validate()) return false;
    emit(state.copyWith(submitting: true, clearError: true));
    if (mode == CashFormMode.close) {
      final r = await noGeoRunner.run(
        key,
        (k, _) => _repo.close(
          session.id,
          handedCash: state.handed!,
          note: state.note,
          key: k,
        ),
      );
      if (isClosed) return false;
      switch (r) {
        case Failure(:final error):
          emit(state.copyWith(submitting: false, error: error));
          return false;
        case Success(:final data):
          key.renew();
          emit(state.copyWith(submitting: false, closed: data));
          return true;
      }
    }
    final r = await noGeoRunner.run(
      key,
      (k, _) => _repo.adjust(
        session.id,
        handedCash: state.handed,
        note: state.note,
        key: k,
      ),
    );
    if (isClosed) return false;
    switch (r) {
      case Failure(:final error):
        emit(state.copyWith(submitting: false, error: error));
        return false;
      case Success(:final data):
        key.renew();
        emit(state.copyWith(submitting: false, adjusted: data));
        return true;
    }
  }
}

// ------------------------------------------------------------------ driver

class DriverState {
  const DriverState({
    this.trucks,
    this.loading = true,
    this.loadError,
    this.submittingTruckId,
    this.error,
    this.done,
  });

  final List<TruckOption>? trucks;
  final bool loading;
  final ApiError? loadError;
  final String? submittingTruckId;
  final ApiError? error;
  final DriverChange? done;

  DriverState copyWith({
    List<TruckOption>? trucks,
    bool? loading,
    ApiError? loadError,
    bool clearLoadError = false,
    String? submittingTruckId,
    bool clearSubmitting = false,
    ApiError? error,
    bool clearError = false,
    DriverChange? done,
  }) => DriverState(
    trucks: trucks ?? this.trucks,
    loading: loading ?? this.loading,
    loadError: clearLoadError ? null : (loadError ?? this.loadError),
    submittingTruckId: clearSubmitting
        ? null
        : (submittingTruckId ?? this.submittingTruckId),
    error: clearError ? null : (error ?? this.error),
    done: done ?? this.done,
  );
}

/// "Qui conduit aujourd'hui ?" for one member: he takes the chosen truck.
///
/// One key per chosen truck: a retry of the same choice (timeout, double
/// tap) sends the same key, so a lost answer never moves him twice; picking
/// another truck is another action with a new key.
class DriverCubit extends Cubit<DriverState> {
  DriverCubit(this._repo, {required this.member}) : super(const DriverState());

  final TeamRepository _repo;
  final SellerDay member;

  IdempotencyKey _key = IdempotencyKey();
  String? _keyTruckId;

  /// The key the next change of [truckId] will send (tests).
  IdempotencyKey keyFor(String truckId) {
    if (_keyTruckId != truckId) {
      _key = IdempotencyKey();
      _keyTruckId = truckId;
    }
    return _key;
  }

  Future<void> load() async {
    emit(state.copyWith(loading: true, clearLoadError: true));
    final r = await _repo.trucks();
    if (isClosed) return;
    switch (r) {
      case Success(:final data):
        final sorted = [...data]
          ..sort((a, b) {
            // His own truck first, then by label.
            final mine = member.vehicle?.id;
            if (a.id == mine) return -1;
            if (b.id == mine) return 1;
            return a.label.toLowerCase().compareTo(b.label.toLowerCase());
          });
        emit(state.copyWith(trucks: sorted, loading: false));
      case Failure(:final error):
        emit(state.copyWith(loading: false, loadError: error));
    }
  }

  Future<DriverChange?> assign(TruckOption truck) async {
    if (state.submittingTruckId != null) return null;
    emit(state.copyWith(submittingTruckId: truck.id, clearError: true));
    final key = keyFor(truck.id);
    final r = await noGeoRunner.run(
      key,
      (k, _) => _repo.changeDriver(truck.id, member.seller.id, k),
    );
    if (isClosed) return null;
    switch (r) {
      case Failure(:final error):
        emit(state.copyWith(clearSubmitting: true, error: error));
        return null;
      case Success(:final data):
        _keyTruckId = null;
        emit(state.copyWith(clearSubmitting: true, done: data));
        return data;
    }
  }
}
