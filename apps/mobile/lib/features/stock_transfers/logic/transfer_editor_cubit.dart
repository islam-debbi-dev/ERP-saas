import 'dart:convert';

import 'package:decimal/decimal.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/models/product_unit.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../catalog/data/models/product.dart';
import '../../team/data/team_models.dart';
import '../../team/logic/team_cubits.dart' show noGeoRunner;
import '../data/stock_transfers_repository.dart';
import '../data/transfer_models.dart';
import 'transfer_form.dart';

class TransferEditorState {
  const TransferEditorState({
    required this.form,
    this.loading = true,
    this.loadError,
    this.transferId,
    this.savedSignature,
    this.depots = const [],
    this.trucks = const [],
    this.sourceStock,
    this.busy = false,
    this.error,
    this.shortProductId,
    this.showErrors = false,
    this.result,
  });

  final TransferForm form;

  /// Dépôts, trucks (and the draft being edited) are loading.
  final bool loading;
  final ApiError? loadError;

  /// The draft on the server, once created.
  final String? transferId;

  /// [TransferForm.signature] of what the server has; null = nothing yet.
  final String? savedSignature;
  final List<DepotOption> depots;
  final List<TruckOption> trucks;

  /// Base quantity per product where the goods leave from (dépôt or truck);
  /// null while unknown.
  final Map<String, Decimal>? sourceStock;

  /// A save or a validation is on its way: every button waits.
  final bool busy;
  final ApiError? error;

  /// The product a STOCK_INSUFFICIENT names: its line is marked.
  final String? shortProductId;
  final bool showErrors;

  /// Set once validated: the screen shows the result.
  final TransferResult? result;

  bool get dirty => savedSignature != form.signature;

  TruckOption? get truck {
    for (final t in trucks) {
      if (t.id == form.truckId) return t;
    }
    return null;
  }

  DepotOption? get depot {
    for (final d in depots) {
      if (d.id == form.depotId) return d;
    }
    return null;
  }

  /// What is left at the source once this line is taken, if known.
  Decimal? availableFor(String productId) =>
      sourceStock == null ? null : (sourceStock![productId] ?? Decimal.zero);

  TransferEditorState copyWith({
    TransferForm? form,
    bool? loading,
    ApiError? loadError,
    String? transferId,
    String? savedSignature,
    List<DepotOption>? depots,
    List<TruckOption>? trucks,
    Map<String, Decimal>? sourceStock,
    bool clearStock = false,
    bool? busy,
    ApiError? error,
    bool clearError = false,
    String? shortProductId,
    bool? showErrors,
    TransferResult? result,
  }) => TransferEditorState(
    form: form ?? this.form,
    loading: loading ?? this.loading,
    loadError: loadError ?? this.loadError,
    transferId: transferId ?? this.transferId,
    savedSignature: savedSignature ?? this.savedSignature,
    depots: depots ?? this.depots,
    trucks: trucks ?? this.trucks,
    sourceStock: clearStock ? null : (sourceStock ?? this.sourceStock),
    busy: busy ?? this.busy,
    error: clearError ? null : (error ?? this.error),
    shortProductId: clearError ? null : (shortProductId ?? this.shortProductId),
    showErrors: showErrors ?? this.showErrors,
    result: result ?? this.result,
  );
}

/// Prepares one chargement / déchargement: a draft (`POST`, then `PUT`
/// while it changes), then its validation.
///
/// Keys (AGENTS §3 rule 6):
/// - the create key is made when the form opens and stays bound to the
///   **first body sent with it**: a retry after a timeout resends exactly
///   that body (the API replays the draft it made), then a `PUT` brings the
///   lines typed since. So one form makes one draft, never
///   IDEMPOTENCY_KEY_REUSED;
/// - the validate key is the form's too: a timeout retry or a double tap
///   sends the same key, and [busy] drops the second tap.
class TransferEditorCubit extends Cubit<TransferEditorState> {
  TransferEditorCubit(
    this._repo, {
    required TransferForm form,
    this.transferId,
    this.loadSourceStock = true,
    this.unloadRest = false,
  }) : super(TransferEditorState(form: form, transferId: transferId));

  final StockTransfersRepository _repo;

  /// A saved draft being edited.
  final String? transferId;

  /// Reads the source's stock for "Disponible" (tests may skip it).
  final bool loadSourceStock;

  /// Déchargement du soir: the lines start as everything left on the truck
  /// (`GET /stock?warehouseId=<truck>`), and follow the truck if it changes
  /// before the first save.
  final bool unloadRest;

  final IdempotencyKey createKey = IdempotencyKey();
  final IdempotencyKey validateKey = IdempotencyKey();

  /// The body first sent with [createKey]; resent as is on a retry.
  Map<String, dynamic>? _createBody;

  /// Dépôts, trucks and (when editing) the draft.
  Future<void> load() async {
    emit(state.copyWith(loading: true));
    final depots = await _repo.depots();
    final trucks = await _repo.trucks();
    if (isClosed) return;
    final failed = [depots, trucks].whereType<Failure<Object?>>().firstOrNull;
    if (failed != null) {
      emit(state.copyWith(loading: false, loadError: failed.error));
      return;
    }
    final depotList = (depots as Success<List<DepotOption>>).data;
    final truckList = (trucks as Success<List<TruckOption>>).data;
    var form = state.form;
    String? saved;
    final id = transferId;
    if (id != null) {
      final r = await _repo.get(id);
      if (isClosed) return;
      switch (r) {
        case Failure(:final error):
          emit(state.copyWith(loading: false, loadError: error));
          return;
        case Success(:final data):
          // Units come from the stock where the goods leave from.
          final products = await _productsOf(data.from.id);
          form = TransferForm.fromTransfer(data, products: products);
          saved = form.signature;
          if (!data.isDraft) {
            emit(
              state.copyWith(
                loading: false,
                form: form,
                savedSignature: saved,
                depots: depotList,
                trucks: truckList,
                result: TransferResult(transfer: data),
              ),
            );
            return;
          }
      }
    }
    form = _withDefaults(form, depotList, truckList);
    emit(
      state.copyWith(
        loading: false,
        form: form,
        savedSignature: saved,
        depots: depotList,
        trucks: truckList,
      ),
    );
    if (unloadRest && id == null) {
      await _prefillRest();
    } else {
      await _refreshSourceStock();
    }
  }

  /// Lines = the truck's rest, and its stock as "Disponible".
  Future<void> _prefillRest() async {
    final truck = state.form.truckId;
    if (truck == null) return;
    emit(state.copyWith(loading: true));
    final r = await _repo.levels(truck, positiveOnly: true);
    if (isClosed || state.form.truckId != truck) return;
    switch (r) {
      case Failure(:final error):
        emit(state.copyWith(loading: false, loadError: error));
      case Success(:final data):
        emit(
          state.copyWith(
            loading: false,
            form: TransferForm.unloadRest(
              truckId: truck,
              depotId: state.form.depotId,
              truckStock: data,
            ).copyWith(note: state.form.note),
            sourceStock: {for (final s in data) s.productId: s.qtyBase},
          ),
        );
    }
  }

  /// The truck's own dépôt (else the only one, else the default) as the
  /// dépôt of a new form.
  TransferForm _withDefaults(
    TransferForm form,
    List<DepotOption> depots,
    List<TruckOption> trucks,
  ) {
    if (form.depotId != null || depots.isEmpty) return form;
    String? parent;
    for (final t in trucks) {
      if (t.id == form.truckId) parent = t.parentId;
    }
    final byParent = depots.where((d) => d.id == parent);
    // Else the default dépôt (listed first).
    final pick = byParent.isNotEmpty ? byParent.first : depots.first;
    return form.copyWith(depotId: pick.id);
  }

  Future<Map<String, Product>> _productsOf(String warehouseId) async {
    final r = await _repo.levels(warehouseId);
    return r is Success<List<StockLevel>>
        ? {for (final s in r.data) s.productId: productOf(s)}
        : const {};
  }

  Future<void> _refreshSourceStock() async {
    final source = state.form.fromId;
    if (!loadSourceStock || source == null) return;
    emit(state.copyWith(clearStock: true));
    final r = await _repo.levels(source);
    if (isClosed || state.form.fromId != source) return;
    if (r case Success(:final data)) {
      emit(
        state.copyWith(
          sourceStock: {for (final s in data) s.productId: s.qtyBase},
        ),
      );
    }
  }

  void _edit(TransferForm form) =>
      emit(state.copyWith(form: form, clearError: true));

  Future<void> setTruck(String id) async {
    _edit(state.form.copyWith(truckId: id));
    if (state.form.isLoad) return;
    if (unloadRest && state.transferId == null) {
      await _prefillRest();
    } else {
      await _refreshSourceStock();
    }
  }

  Future<void> setDepot(String id) async {
    _edit(state.form.copyWith(depotId: id));
    if (state.form.isLoad) await _refreshSourceStock();
  }

  void add(Product p, ProductUnit unit, Decimal qty) =>
      _edit(state.form.add(p, unit, qty));

  void setLine(String productId, ProductUnit unit, Decimal qty) =>
      _edit(state.form.set(productId, unit, qty));

  void step(String productId, int by) => _edit(state.form.step(productId, by));

  void remove(String productId) => _edit(state.form.remove(productId));

  void setNote(String note) => _edit(state.form.copyWith(note: note));

  /// Base quantity already on the form for [productId] (the picker shows
  /// what is left at the source).
  Decimal takenBase(String productId) =>
      state.form.lineOf(productId)?.qtyBase ?? Decimal.zero;

  /// Saves the draft: POST the first time, PUT when it changed. True when
  /// the server has the current form.
  Future<bool> save() async {
    if (state.busy) return false;
    if (!state.form.canSave()) {
      emit(state.copyWith(showErrors: true));
      return false;
    }
    emit(state.copyWith(busy: true, clearError: true));
    final ok = await _persist();
    if (!isClosed) emit(state.copyWith(busy: false));
    return ok;
  }

  Future<bool> _persist() async {
    var id = state.transferId;
    if (id == null) {
      final body = _createBody ??= state.form.toBody();
      final r = await noGeoRunner.run(
        createKey,
        (k, _) => _repo.create(body, key: k),
      );
      if (isClosed) return false;
      switch (r) {
        case Failure(:final error):
          // A refusal (4xx) made nothing and released the key: the next try
          // sends the corrected form. Unknown outcome (network, 5xx): resend
          // the same body to get the draft back if it was made.
          final known =
              (error.statusCode ?? 0) >= 400 && (error.statusCode ?? 0) < 500;
          if (known && error.code != 'IDEMPOTENCY_REQUEST_IN_PROGRESS') {
            _createBody = null;
          }
          emit(state.copyWith(error: error));
          return false;
        case Success(:final data):
          id = data.id;
          emit(
            state.copyWith(
              transferId: id,
              // Same encoding as TransferForm.signature.
              savedSignature: jsonEncode(body),
            ),
          );
      }
    }
    if (!state.dirty) return true;
    final current = state.form;
    final r = await _repo.update(id, current.toBody());
    if (isClosed) return false;
    switch (r) {
      case Failure(:final error):
        if (error.code == 'TRANSFER_NOT_DRAFT') return _reloadDone(id);
        emit(state.copyWith(error: error));
        return false;
      case Success():
        emit(state.copyWith(savedSignature: current.signature));
        return true;
    }
  }

  /// Saves if needed, then validates. Safe to call twice: the second call
  /// returns while the first runs, and a retry reuses [validateKey].
  Future<bool> validate() async {
    if (state.busy || state.result != null) return false;
    if (!state.form.canSave(forValidation: true)) {
      emit(state.copyWith(showErrors: true));
      return false;
    }
    emit(state.copyWith(busy: true, clearError: true));
    final saved = await _persist();
    if (!saved || isClosed) {
      if (!isClosed) emit(state.copyWith(busy: false));
      return false;
    }
    if (state.result != null) {
      emit(state.copyWith(busy: false));
      return true;
    }
    final id = state.transferId!;
    final r = await noGeoRunner.run(
      validateKey,
      (k, _) => _repo.validate(id, key: k),
    );
    if (isClosed) return false;
    switch (r) {
      case Failure(:final error):
        if (error.code == 'TRANSFER_NOT_DRAFT') {
          final done = await _reloadDone(id);
          if (!isClosed) emit(state.copyWith(busy: false));
          return done;
        }
        final short = error.code == 'STOCK_INSUFFICIENT'
            ? error.detail('productId')
            : null;
        emit(
          state.copyWith(
            busy: false,
            error: error,
            shortProductId: short is String ? short : null,
          ),
        );
        return false;
      case Success(:final data):
        emit(state.copyWith(busy: false, result: data));
        return true;
    }
  }

  /// The draft is no longer one (a lost answer after it was validated, or
  /// someone else did it): show it as the server has it.
  Future<bool> _reloadDone(String id) async {
    final r = await _repo.get(id);
    if (isClosed) return false;
    if (r case Success(:final data) when !data.isDraft) {
      emit(state.copyWith(result: TransferResult(transfer: data)));
      return true;
    }
    if (r case Failure(:final error)) emit(state.copyWith(error: error));
    return false;
  }
}
