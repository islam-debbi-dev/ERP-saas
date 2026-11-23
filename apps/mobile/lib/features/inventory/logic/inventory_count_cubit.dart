import 'package:decimal/decimal.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/helpers/money.dart';
import '../../../core/models/product_unit.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../catalog/data/models/product.dart';
import '../../stock_transfers/data/stock_transfers_repository.dart';
import '../../stock_transfers/logic/transfer_form.dart' show productOf;
import '../../team/logic/team_cubits.dart' show noGeoRunner;
import '../data/inventories_repository.dart';

/// One counted product on the phone: what the server has, plus what was
/// typed since the last save.
class CountLine {
  const CountLine({
    required this.productId,
    required this.designation,
    required this.reference,
    required this.counted,
    this.product,
    this.expected,
    this.pending = false,
  });

  final String productId;
  final String designation;
  final String reference;

  /// Counted quantity in the base unit.
  final Decimal counted;

  /// The product's units (cartons / pièces) when known.
  final Product? product;

  /// The dépôt's quantity (server's "expected"); shown only with
  /// STOCK_ADJUST.
  final Decimal? expected;

  /// Typed and not saved yet.
  final bool pending;

  Decimal? get diff => expected == null ? null : counted - expected!;
}

class InventoryCountState {
  const InventoryCountState({
    this.inventory,
    this.loading = true,
    this.loadError,
    this.products = const {},
    this.changes = const {},
    this.busy = false,
    this.error,
  });

  final Inventory? inventory;
  final bool loading;
  final ApiError? loadError;

  /// Units of the dépôt's products (from its stock list), by product id.
  final Map<String, Product> products;

  /// Counts typed since the last save, base unit; null = remove the line.
  final Map<String, ({Product product, Decimal? counted})> changes;
  final bool busy;
  final ApiError? error;

  bool get dirty => changes.isNotEmpty;
  bool get isOpen => inventory?.isOpen ?? false;

  /// Server lines with the typed counts on top, new products last.
  List<CountLine> get lines {
    final inv = inventory;
    if (inv == null) return const [];
    final out = <CountLine>[];
    final seen = <String>{};
    for (final l in inv.lines) {
      seen.add(l.productId);
      final c = changes[l.productId];
      if (c != null && c.counted == null) continue;
      out.add(
        CountLine(
          productId: l.productId,
          designation: l.designation,
          reference: l.reference,
          counted: c?.counted ?? l.countedQtyBase,
          product: c?.product ?? products[l.productId],
          expected: l.expectedQtyBase,
          pending: c != null,
        ),
      );
    }
    for (final e in changes.entries) {
      final counted = e.value.counted;
      if (seen.contains(e.key) || counted == null) continue;
      out.add(
        CountLine(
          productId: e.key,
          designation: e.value.product.designation,
          reference: e.value.product.reference,
          counted: counted,
          product: e.value.product,
          pending: true,
        ),
      );
    }
    return out;
  }

  InventoryCountState copyWith({
    Inventory? inventory,
    bool? loading,
    ApiError? loadError,
    Map<String, Product>? products,
    Map<String, ({Product product, Decimal? counted})>? changes,
    bool? busy,
    ApiError? error,
    bool clearError = false,
  }) => InventoryCountState(
    inventory: inventory ?? this.inventory,
    loading: loading ?? this.loading,
    loadError: loadError ?? this.loadError,
    products: products ?? this.products,
    changes: changes ?? this.changes,
    busy: busy ?? this.busy,
    error: clearError ? null : (error ?? this.error),
  );
}

/// An inventaire being counted (`/inventories/:id`): a pick or a scan
/// **adds** to the product's count, tapping a line **sets** it, a line can
/// be removed. *Enregistrer* sends only what changed (`PUT …/lines`, an
/// upsert: sending it twice changes nothing). *Valider* (STOCK_ADJUST only)
/// saves first, then `POST …/validate` with one key for the screen.
class InventoryCountCubit extends Cubit<InventoryCountState> {
  InventoryCountCubit(
    this._repo,
    this._stock, {
    required this.inventoryId,
    required this.canValidate,
  }) : super(const InventoryCountState());

  final InventoriesRepository _repo;
  final StockTransfersRepository _stock;
  final String inventoryId;

  /// STOCK_ADJUST: validation (the API refuses it otherwise).
  final bool canValidate;

  final IdempotencyKey validateKey = IdempotencyKey();

  Future<void> load() async {
    emit(state.copyWith(loading: true));
    final r = await _repo.get(inventoryId);
    if (isClosed) return;
    switch (r) {
      case Failure(:final error):
        emit(state.copyWith(loading: false, loadError: error));
        return;
      case Success(:final data):
        emit(state.copyWith(loading: false, inventory: data));
        final depot = data.warehouseId;
        if (depot == null) return;
        final levels = await _stock.levels(depot);
        if (isClosed) return;
        if (levels case Success(data: final list)) {
          emit(
            state.copyWith(
              products: {for (final s in list) s.productId: productOf(s)},
            ),
          );
        }
    }
  }

  Decimal _current(String productId) {
    for (final l in state.lines) {
      if (l.productId == productId) return l.counted;
    }
    return Decimal.zero;
  }

  void _put(Product product, Decimal? counted) => emit(
    state.copyWith(
      changes: {
        ...state.changes,
        product.id: (product: product, counted: counted),
      },
      clearError: true,
    ),
  );

  /// A pick or a scan: [qty] of [unit] more.
  void add(Product product, ProductUnit unit, Decimal qty) =>
      _put(product, _current(product.id) + unit.toBase(qty));

  /// The edit sheet: the count is [qty] of [unit].
  void set(Product product, ProductUnit unit, Decimal qty) =>
      _put(product, unit.toBase(qty));

  void remove(Product product) => _put(product, null);

  /// The product of a line (its units), or a bare one in the base unit.
  Product productFor(CountLine line) =>
      line.product ??
      Product(
        id: line.productId,
        reference: line.reference,
        designation: line.designation,
        baseUnitId: '',
        tvaRate: Decimal.zero,
      );

  /// The PUT body: counts in the base unit, removals with `qty: null`.
  List<Map<String, dynamic>> changesBody() => [
    for (final e in state.changes.entries)
      e.value.counted == null
          ? {'productId': e.key, 'qty': null}
          : {
              'productId': e.key,
              'unitId': e.value.product.baseUnitId,
              'qty': Qty.toApi(e.value.counted!),
            },
  ];

  Future<bool> save() async {
    if (state.busy || !state.isOpen) return false;
    if (!state.dirty) return true;
    emit(state.copyWith(busy: true, clearError: true));
    final ok = await _save();
    if (!isClosed) emit(state.copyWith(busy: false));
    return ok;
  }

  Future<bool> _save() async {
    if (!state.dirty) return true;
    final sent = state.changes;
    final r = await _repo.setLines(inventoryId, changesBody());
    if (isClosed) return false;
    switch (r) {
      case Failure(:final error):
        emit(state.copyWith(error: error));
        return false;
      case Success(:final data):
        // Keep what was typed while the request ran.
        final left = {
          for (final e in state.changes.entries)
            if (!identical(sent[e.key], e.value)) e.key: e.value,
        };
        emit(state.copyWith(inventory: data, changes: left));
        return true;
    }
  }

  Future<bool> validate() async {
    if (!canValidate || state.busy || !state.isOpen) return false;
    emit(state.copyWith(busy: true, clearError: true));
    if (!await _save() || isClosed) {
      if (!isClosed) emit(state.copyWith(busy: false));
      return false;
    }
    final r = await noGeoRunner.run(
      validateKey,
      (k, _) => _repo.validate(inventoryId, key: k),
    );
    if (isClosed) return false;
    switch (r) {
      case Failure(:final error):
        emit(state.copyWith(busy: false, error: error));
        return false;
      case Success(:final data):
        emit(state.copyWith(busy: false, inventory: data));
        return true;
    }
  }
}

/// Opens a count (`POST /inventories`). The key is made when the sheet
/// opens and kept across its retries: one tap twice is one inventory.
class NewCountAction {
  NewCountAction(this._repo);

  final InventoriesRepository _repo;
  final IdempotencyKey key = IdempotencyKey();
  String? _depot;

  Future<ApiResult<Inventory>> start(String depotId) {
    // Another dépôt is another action: a new key.
    if (_depot != null && _depot != depotId) key.renew();
    _depot = depotId;
    return noGeoRunner.run(key, (k, _) => _repo.create(depotId, key: k));
  }
}
