import 'package:decimal/decimal.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/geo/geo_fix.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../../core/network/money_action.dart';
import '../../orders/data/models/order.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../sales/data/models/sale.dart';
import '../../sales/data/repo/sales_repository.dart';
import '../../sales/logic/basket.dart';
import '../data/deliver_result.dart';
import 'delivery_form.dart';

class DeliveryState {
  const DeliveryState({
    this.form,
    this.loading = true,
    this.loadError,
    this.packaging = const {},
    this.paid,
    this.mode = PaymentModeValue.especes,
    this.submitting = false,
    this.error,
    this.delivered,
    this.bl,
  });

  /// Null until the order is loaded.
  final DeliveryForm? form;
  final bool loading;
  final ApiError? loadError;

  /// Empties handed back: packaging type id → count.
  final Map<String, int> packaging;

  /// What the client pays now; null = nothing typed (all on credit).
  final Decimal? paid;
  final PaymentModeValue mode;
  final bool submitting;

  /// The last refused delivery, shown above the form (never swallowed).
  final ApiError? error;

  /// The API's answer once delivered.
  final DeliverResult? delivered;

  /// The BL as the API saved it (`GET /sales/:id` after the delivery); null
  /// when that read failed: the screen then shows [delivered]'s summary.
  final SaleResult? bl;

  Order? get order => form?.order;
  Decimal get paidOrZero => paid ?? Decimal.zero;

  /// What stays on credit, by the preview.
  Decimal? get credit {
    final ttc = form?.totals.totalTtc;
    if (ttc == null) return null;
    final rest = ttc - paidOrZero;
    return rest < Decimal.zero ? Decimal.zero : rest;
  }

  bool get canSubmit =>
      form != null &&
      form!.order.isConfirmed &&
      form!.anyDelivered &&
      !submitting &&
      delivered == null;

  DeliveryState copyWith({
    DeliveryForm? form,
    bool? loading,
    ApiError? loadError,
    bool clearLoadError = false,
    Map<String, int>? packaging,
    Decimal? paid,
    bool clearPaid = false,
    PaymentModeValue? mode,
    bool? submitting,
    ApiError? error,
    bool clearError = false,
    DeliverResult? delivered,
    SaleResult? bl,
  }) => DeliveryState(
    form: form ?? this.form,
    loading: loading ?? this.loading,
    loadError: clearLoadError ? null : (loadError ?? this.loadError),
    packaging: packaging ?? this.packaging,
    paid: clearPaid ? null : (paid ?? this.paid),
    mode: mode ?? this.mode,
    submitting: submitting ?? this.submitting,
    error: clearError ? null : (error ?? this.error),
    delivered: delivered ?? this.delivered,
    bl: bl ?? this.bl,
  );
}

/// Delivering one order (`POST /orders/:id/deliver`).
///
/// The [key] is created when the screen opens and kept across retries: a
/// double tap, a timeout or a GEO_NOTE_REQUIRED resend replays the same
/// delivery on the API instead of making a second BL. It is renewed only
/// after a success.
class DeliveryCubit extends Cubit<DeliveryState> {
  DeliveryCubit(this._orders, this._sales, {required this.orderId})
    : super(const DeliveryState());

  final OrdersRepository _orders;
  final SalesRepository _sales;
  final String orderId;

  final IdempotencyKey key = IdempotencyKey();

  Future<void> load() async {
    emit(state.copyWith(loading: true, clearLoadError: true));
    final result = await _orders.get(orderId);
    if (isClosed) return;
    switch (result) {
      case Success(:final data):
        emit(state.copyWith(form: DeliveryForm(data), loading: false));
      case Failure(:final error):
        emit(state.copyWith(loading: false, loadError: error));
    }
  }

  // ------------------------------------------------------------ quantities

  void _setForm(DeliveryForm form) {
    if (state.submitting || state.delivered != null) return;
    emit(state.copyWith(form: form, clearError: true));
  }

  void setQty(OrderLine line, Decimal qty) =>
      _setForm(state.form!.withQty(line, qty));
  void increment(OrderLine line) => _setForm(state.form!.increment(line));
  void decrement(OrderLine line) => _setForm(state.form!.decrement(line));
  void deliverAll(OrderLine line) => setQty(line, line.qty);
  void deliverNone(OrderLine line) => setQty(line, Decimal.zero);

  // ------------------------------------------------------------ payment

  void setPaid(Decimal? amount) => emit(
    state.copyWith(paid: amount, clearPaid: amount == null, clearError: true),
  );

  /// "Tout payé": the previewed TTC of what is delivered.
  void payAll() {
    final ttc = state.form?.totals.totalTtc;
    if (ttc != null) setPaid(ttc);
  }

  void setMode(PaymentModeValue mode) => emit(state.copyWith(mode: mode));

  void setPackaging(String typeId, int count) {
    final next = {...state.packaging};
    if (count <= 0) {
      next.remove(typeId);
    } else {
      next[typeId] = count;
    }
    emit(state.copyWith(packaging: next));
  }

  // ------------------------------------------------------------ save

  Map<String, dynamic> body({required GeoFix? geo, String? geoNote}) =>
      state.form!.body(
        paid: state.paidOrZero,
        mode: state.mode,
        packagingReturned: state.packaging,
        geo: geoInputJson(geo, note: geoNote),
      );

  /// Sends the delivery with the screen's key, then reads the BL the API
  /// made. A failure stays in the state with the same key, so tapping again
  /// after a timeout replays instead of making a second BL.
  Future<DeliverResult?> submit({
    required GeoFix? geo,
    required MoneyActionRunner runner,
  }) async {
    if (!state.canSubmit) return null;
    emit(state.copyWith(submitting: true, clearError: true));
    final result = await runner.run(
      key,
      (k, note) => _orders.deliver(orderId, body(geo: geo, geoNote: note), k),
    );
    if (isClosed) return null;
    switch (result) {
      case Failure(:final error):
        emit(state.copyWith(submitting: false, error: error));
        return null;
      case Success(:final data):
        key.renew();
        final sale = await _sales.get(data.saleId);
        if (isClosed) return data;
        emit(
          state.copyWith(
            submitting: false,
            delivered: data,
            form: DeliveryForm(data.order),
            bl: sale is Success<Sale>
                ? SaleResult(
                    sale: sale.data,
                    change: data.change,
                    warnings: data.warnings,
                    geoStatus: data.geoStatus,
                  )
                : null,
          ),
        );
        return data;
    }
  }
}
