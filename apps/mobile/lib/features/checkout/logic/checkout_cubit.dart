import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/service/api_error_handler.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../../account/data/models/address.dart';
import '../../cart/logic/cart_cubit.dart';
import '../../order/data/models/order.dart';
import '../../order/data/repo/orders_repository.dart';

class CheckoutState {
  /// The saved address to deliver to; `null` = "I'll give my address by
  /// phone" (the address is optional).
  final String? addressId;
  final bool submitting;
  final ErrorHandler? error;

  /// Set once the order is created; the screen navigates away on it.
  final Order? placed;

  const CheckoutState({
    this.addressId,
    this.submitting = false,
    this.error,
    this.placed,
  });

  CheckoutState copyWith({
    String? addressId,
    bool? submitting,
    ErrorHandler? error,
    Order? placed,
  }) => CheckoutState(
    addressId: addressId ?? this.addressId,
    submitting: submitting ?? this.submitting,
    error: error,
    placed: placed ?? this.placed,
  );
}

/// Cart → `POST /orders` (cash on delivery), to a saved address or with no
/// address at all: the admin calls every client and can take it then.
class CheckoutCubit extends Cubit<CheckoutState> {
  CheckoutCubit(this._orders, this._cart, this._session)
    : super(CheckoutState(addressId: _session.user?.defaultAddress?.id)) {
    _knownIds = addresses.map((a) => a.id).toSet();
  }

  final OrderRepository _orders;
  final CartCubit _cart;
  final SessionCubit _session;

  List<Address> get addresses => _session.user?.addresses ?? const [];

  /// Address ids seen so far, to spot the one just added from this screen.
  late Set<String> _knownIds;

  void selectAddress(String id) => emit(state.copyWith(addressId: id));

  /// "I'll give my address by phone": the order goes out without an address.
  void selectNoAddress() => emit(const CheckoutState());

  /// Keeps the selection valid after the address book changed: a freshly
  /// added address gets selected, a deleted one falls back to the default.
  /// "No address" stays a valid choice.
  void syncAddresses() {
    final ids = addresses.map((a) => a.id).toSet();
    final added = ids.difference(_knownIds);
    _knownIds = ids;
    if (added.isNotEmpty) {
      emit(CheckoutState(addressId: added.last));
    } else if (state.addressId != null && !ids.contains(state.addressId)) {
      emit(CheckoutState(addressId: _session.user?.defaultAddress?.id));
    }
  }

  /// Codes about one cart line's size / options; the cart shows them on it.
  static const lineErrorCodes = {
    'PRODUCT_OPTIONS_REQUIRED',
    'PRODUCT_OPTION_UNAVAILABLE',
    'PRODUCT_OPTION_RULE',
  };

  /// True when the last failure points at a cart line to fix.
  bool get failedOnLine =>
      lineErrorCodes.contains(state.error?.apiErrorModel.code);

  /// `details[0].field` is `items.<index>`; the request lists the cart lines
  /// in order, so the index is the line.
  void _markLineError(ErrorHandler error) {
    final model = error.apiErrorModel;
    if (!lineErrorCodes.contains(model.code)) return;
    final first = model.details?.firstOrNull;
    final field = first is Map ? first['field']?.toString() ?? '' : '';
    final index = int.tryParse(field.split('.').elementAtOrNull(1) ?? '');
    final key = index == null ? null : _cart.lineKeyAt(index);
    if (key != null) _cart.markLineError(key, model.message ?? '');
  }

  Future<void> submit({String? note, String? customRequest}) async {
    final user = _session.user;
    if (user == null || state.submitting) return;
    // No match = no address: the request then carries no address fields.
    final address = addresses.where((a) => a.id == state.addressId).firstOrNull;

    emit(state.copyWith(submitting: true));
    final request = _cart.buildOrderRequest(
      user: user,
      address: address,
      note: note,
      customRequest: customRequest,
    );
    final result = await _orders.createOrder(request);
    if (isClosed) return;
    switch (result) {
      case Success(:final data):
        _cart.clear();
        _cart.onOrderPlaced(data);
        emit(state.copyWith(submitting: false, placed: data));
      case Failure(:final message):
        _markLineError(message);
        emit(state.copyWith(submitting: false, error: message));
    }
  }
}
