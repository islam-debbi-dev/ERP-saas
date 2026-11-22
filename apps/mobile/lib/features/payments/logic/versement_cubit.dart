import 'package:decimal/decimal.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/geo/geo_fix.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../../core/network/money_action.dart';
import '../../clients/data/models/client.dart';
import '../../clients/data/repo/clients_repository.dart';
import '../../sales/logic/basket.dart';
import '../data/models/payment.dart';
import '../data/repo/payments_repository.dart';
import 'versement_form.dart';

class VersementState {
  const VersementState({
    this.form = const VersementForm(),
    this.unpaid = const [],
    this.submitting = false,
    this.showErrors = false,
    this.error,
    this.result,
  });

  final VersementForm form;
  final List<UnpaidDocument> unpaid;
  final bool submitting;

  /// Field errors show after the first tap on "Enregistrer".
  final bool showErrors;
  final ApiError? error;
  final Payment? result;

  List<String> get errors => form.errors(unpaid);

  VersementState copyWith({
    VersementForm? form,
    List<UnpaidDocument>? unpaid,
    bool? submitting,
    bool? showErrors,
    ApiError? error,
    bool clearError = false,
    Payment? result,
  }) => VersementState(
    form: form ?? this.form,
    unpaid: unpaid ?? this.unpaid,
    submitting: submitting ?? this.submitting,
    showErrors: showErrors ?? this.showErrors,
    error: clearError ? null : (error ?? this.error),
    result: result ?? this.result,
  );
}

/// A versement for one client. The [key] is created when the form opens and
/// kept for every retry of this versement (timeout, GEO note): the API
/// replays instead of recording the money twice.
class VersementCubit extends Cubit<VersementState> {
  VersementCubit(this._payments, this._clients, {required this.clientId})
    : super(const VersementState());

  final PaymentsRepository _payments;
  final ClientsRepository _clients;
  final String clientId;
  final IdempotencyKey key = IdempotencyKey();

  Future<void> loadUnpaid() async {
    final r = await _clients.unpaidDocuments(clientId);
    if (!isClosed && r is Success<List<UnpaidDocument>>) {
      emit(state.copyWith(unpaid: r.data));
    }
  }

  void _form(VersementForm f) =>
      emit(state.copyWith(form: f, clearError: true));

  void setAmount(Decimal? v) =>
      _form(state.form.copyWith(amount: v, clearAmount: v == null));
  void setMode(PaymentModeValue m) => _form(state.form.copyWith(mode: m));
  void setReference(String v) => _form(state.form.copyWith(reference: v));
  void setBank(String v) => _form(state.form.copyWith(bank: v));
  void setDueDate(String v) => _form(state.form.copyWith(dueDate: v));
  void setNote(String v) => _form(state.form.copyWith(note: v));

  /// Gives [amount] to document [saleId]; null or zero takes it off.
  void allocate(String saleId, Decimal? amount) {
    final next = {...state.form.allocations};
    if (amount == null || amount <= Decimal.zero) {
      next.remove(saleId);
    } else {
      next[saleId] = amount;
    }
    _form(state.form.copyWith(allocations: next));
  }

  Future<Payment?> submit({
    required GeoFix? geo,
    required MoneyActionRunner runner,
  }) async {
    if (state.submitting) return null;
    if (state.errors.isNotEmpty) {
      emit(state.copyWith(showErrors: true));
      return null;
    }
    emit(state.copyWith(submitting: true, clearError: true, showErrors: true));
    final result = await runner.run(
      key,
      (k, note) => _payments.create(
        state.form.toJson(clientId: clientId, geo: geo, geoNote: note),
        k,
      ),
    );
    if (isClosed) return null;
    switch (result) {
      case Success(:final data):
        emit(state.copyWith(submitting: false, result: data));
        return data;
      case Failure(:final error):
        emit(state.copyWith(submitting: false, error: error));
        return null;
    }
  }
}
