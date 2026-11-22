import 'dart:async';

import 'package:decimal/decimal.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/geo/geo_fix.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/models/product_unit.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../../core/network/money_action.dart';
import '../../catalog/data/models/product.dart';
import '../../orders/data/models/order.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../orders/logic/order_submitter.dart';
import '../data/models/pricing.dart';
import '../data/models/sale.dart';
import '../data/repo/sales_repository.dart';
import 'basket.dart';

class SaleBasketState {
  const SaleBasketState({
    this.client,
    this.lines = const [],
    this.preview,
    this.pricing = false,
    this.pricingError,
    this.packaging = const {},
    this.paid,
    this.mode = PaymentModeValue.especes,
    this.submitting = false,
    this.error,
    this.result,
    this.order,
    this.orderDraft,
  });

  /// Null = vente comptoir (nothing may stay on credit).
  final BasketClient? client;
  final List<BasketLine> lines;

  /// The API's pricing of [lines] (null before the first answer).
  final PricingPreview? preview;
  final bool pricing;
  final ApiError? pricingError;

  /// Packaging the client brings back: type id → count.
  final Map<String, int> packaging;

  /// What the client hands over now; null = not typed yet.
  final Decimal? paid;
  final PaymentModeValue mode;
  final bool submitting;

  /// The last failed save (shown above the basket, never swallowed).
  final ApiError? error;

  /// The saved sale, as the API answered it.
  final SaleResult? result;

  /// The confirmed order (prévente), as the API answered it.
  final Order? order;

  /// An order created but not confirmed yet: the basket is locked and the
  /// next tap only confirms it.
  final Order? orderDraft;

  bool get isEmpty => lines.isEmpty;
  int get lineCount => lines.length;

  /// The estimated TTC (the preview's, until the save gives the real one).
  Decimal? get estimatedTtc => preview?.totalTtc;

  /// What will be sent as paid: typed, or zero.
  Decimal get paidOrZero => paid ?? Decimal.zero;

  /// What stays on credit, by the estimate.
  Decimal? get estimatedCredit {
    final ttc = estimatedTtc;
    if (ttc == null) return null;
    final rest = ttc - paidOrZero;
    return rest < Decimal.zero ? Decimal.zero : rest;
  }

  SaleBasketState copyWith({
    BasketClient? client,
    bool clearClient = false,
    List<BasketLine>? lines,
    PricingPreview? preview,
    bool clearPreview = false,
    bool? pricing,
    ApiError? pricingError,
    bool clearPricingError = false,
    Map<String, int>? packaging,
    Decimal? paid,
    bool clearPaid = false,
    PaymentModeValue? mode,
    bool? submitting,
    ApiError? error,
    bool clearError = false,
    SaleResult? result,
    bool clearResult = false,
    Order? order,
    Order? orderDraft,
  }) => SaleBasketState(
    client: clearClient ? null : (client ?? this.client),
    lines: lines ?? this.lines,
    preview: clearPreview ? null : (preview ?? this.preview),
    pricing: pricing ?? this.pricing,
    pricingError: clearPricingError
        ? null
        : (pricingError ?? this.pricingError),
    packaging: packaging ?? this.packaging,
    paid: clearPaid ? null : (paid ?? this.paid),
    mode: mode ?? this.mode,
    submitting: submitting ?? this.submitting,
    error: clearError ? null : (error ?? this.error),
    result: clearResult ? null : (result ?? this.result),
    order: order ?? this.order,
    orderDraft: orderDraft ?? this.orderDraft,
  );
}

/// The basket of a van sale (and, in M1 step 4, of an order).
///
/// Every change asks the API to price the basket again (debounced; an answer
/// that is not the latest is dropped). The [key] is created when the form
/// opens and kept across retries: a double tap or a timeout replays the same
/// sale on the API instead of making a second BL. [startNew] renews it after
/// a success.
class SaleBasketCubit extends Cubit<SaleBasketState> {
  SaleBasketCubit(
    this._repo, {
    OrdersRepository? orders,
    BasketClient? client,
    this.policy = const DiscountPolicy.none(),
    this.debounce = const Duration(milliseconds: 350),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now,
       _orders = orders == null ? null : OrderSubmitter(orders),
       super(SaleBasketState(client: client));

  final OrderSubmitter? _orders;

  final SalesRepository _repo;
  final Duration debounce;
  final DateTime Function() _clock;
  DiscountPolicy policy;

  /// The Idempotency-Key of the sale being built.
  final IdempotencyKey key = IdempotencyKey();

  Timer? _timer;
  int _generation = 0;

  // ------------------------------------------------------------- client

  void setClient(BasketClient? client) {
    emit(
      state.copyWith(
        client: client,
        clearClient: client == null,
        clearError: true,
      ),
    );
    _schedulePricing();
  }

  // ------------------------------------------------------------- lines

  /// Adds [qty] of [product] in [unit]; the same product and unit adds up.
  void add(Product product, ProductUnit unit, Decimal qty) {
    if (qty <= Decimal.zero) return;
    final lines = [...state.lines];
    final i = lines.indexWhere((l) => l.sameAs(product, unit));
    if (i >= 0) {
      lines[i] = lines[i].copyWith(qty: lines[i].qty + qty);
    } else {
      lines.add(BasketLine(product: product, unit: unit, qty: qty));
    }
    _setLines(lines);
  }

  /// Sets line [index] to [qty]; zero or less removes it.
  void setQty(int index, Decimal qty) {
    if (index < 0 || index >= state.lines.length) return;
    final lines = [...state.lines];
    if (qty <= Decimal.zero) {
      lines.removeAt(index);
    } else {
      lines[index] = lines[index].copyWith(qty: qty);
    }
    _setLines(lines);
  }

  void increment(int index) {
    final l = state.lines[index];
    setQty(index, l.qty + Decimal.one);
  }

  void decrement(int index) {
    final l = state.lines[index];
    setQty(index, l.qty - Decimal.one);
  }

  void remove(int index) => setQty(index, Decimal.zero);

  /// Cartons ↔ pièces: the typed quantity stays, its unit changes.
  void setUnit(int index, ProductUnit unit) {
    final lines = [...state.lines];
    lines[index] = lines[index].copyWith(unit: unit);
    _setLines(lines);
  }

  /// A remise on line [index], clamped to the user's rights; ignored without
  /// PRICE_OVERRIDE.
  void setDiscount(int index, Decimal? pct) {
    final lines = [...state.lines];
    if (pct == null || pct == Decimal.zero) {
      lines[index] = lines[index].copyWith(clearDiscount: true);
    } else {
      final clamped = policy.clamp(pct);
      if (clamped == null) return;
      lines[index] = lines[index].copyWith(discountPct: clamped);
    }
    _setLines(lines);
  }

  void _setLines(List<BasketLine> lines) {
    // A draft order exists on the API with these lines: only confirm it now.
    if (state.orderDraft != null) return;
    emit(state.copyWith(lines: lines, clearError: true));
    _schedulePricing();
  }

  // ------------------------------------------------------------- payment

  void setPaid(Decimal? amount) => emit(
    state.copyWith(paid: amount, clearPaid: amount == null, clearError: true),
  );

  /// "Tout payé": the estimated TTC.
  void payAll() {
    final ttc = state.estimatedTtc;
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

  // ------------------------------------------------------------- pricing

  void _schedulePricing() {
    _timer?.cancel();
    final generation = ++_generation;
    if (state.lines.isEmpty) {
      emit(
        state.copyWith(
          clearPreview: true,
          pricing: false,
          clearPricingError: true,
        ),
      );
      return;
    }
    emit(state.copyWith(pricing: true));
    _timer = Timer(debounce, () => _price(generation));
  }

  /// Prices now (tests, pull to refresh).
  Future<void> priceNow() {
    _timer?.cancel();
    return _price(++_generation);
  }

  Future<void> _price(int generation) async {
    if (state.lines.isEmpty) return;
    final result = await _repo.preview(
      clientId: state.client?.id,
      lines: [for (final l in state.lines) l.toJson()],
    );
    if (isClosed || generation != _generation) return;
    switch (result) {
      case Success(:final data):
        emit(
          state.copyWith(
            preview: data,
            pricing: false,
            clearPricingError: true,
          ),
        );
      case Failure(:final error):
        emit(state.copyWith(pricing: false, pricingError: error));
    }
  }

  // ------------------------------------------------------------- save

  /// The `POST /sales/quick` body for this basket.
  Map<String, dynamic> body({
    required String? truckId,
    required GeoFix? geo,
    String? geoNote,
  }) => quickSaleBody(
    client: state.client,
    lines: state.lines,
    documentDate: AlgiersDay.of(_clock()),
    truckId: truckId,
    paid: state.paidOrZero,
    mode: state.mode,
    packagingReturned: state.packaging,
    geo: geoInputJson(geo, note: geoNote),
  );

  /// Saves the sale with the form's key. A failure stays in the state with
  /// the same key, so tapping again after a timeout replays, not duplicates.
  Future<SaleResult?> submit({
    required String? truckId,
    required GeoFix? geo,
    required MoneyActionRunner runner,
  }) async {
    if (state.submitting || state.lines.isEmpty) return null;
    emit(state.copyWith(submitting: true, clearError: true));
    final result = await runner.run(
      key,
      (k, note) =>
          _repo.quickSale(body(truckId: truckId, geo: geo, geoNote: note), k),
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

  /// Records the basket as a confirmed order (no GPS in the order schema).
  /// Needs a client and the orders repository.
  Future<Order?> submitOrder({String? requestedDate, String? note}) async {
    final orders = _orders;
    final client = state.client;
    if (orders == null || client == null) return null;
    if (state.submitting || state.lines.isEmpty) return null;
    emit(state.copyWith(submitting: true, clearError: true));
    final result = await orders.submit(
      orderBody(
        clientId: client.id,
        lines: [for (final l in state.lines) l.toJson()],
        requestedDate: requestedDate,
        note: note,
      ),
    );
    if (isClosed) return null;
    switch (result) {
      case Success(:final data):
        emit(state.copyWith(submitting: false, order: data));
        return data;
      case Failure(:final error):
        emit(
          state.copyWith(
            submitting: false,
            error: error,
            orderDraft: orders.draft,
          ),
        );
        return null;
    }
  }

  /// After a saved sale: an empty basket for the next client, a new key.
  void startNew({bool keepClient = false}) {
    _timer?.cancel();
    _generation++;
    key.renew();
    emit(SaleBasketState(client: keepClient ? state.client : null));
  }

  @override
  Future<void> close() {
    _timer?.cancel();
    return super.close();
  }
}
