import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/paging/paged_cubit.dart';
import '../../../../core/service/api_error_handler.dart';
import '../../../../core/service/api_result.dart';
import '../../data/models/product.dart';
import '../../data/models/product_query.dart';
import '../../data/models/store.dart';
import '../../data/repo/catalog_repository.dart';

/// The store page: the store (header + menu sections) and the selected
/// section. `null` = "All".
class StoreMenuState {
  const StoreMenuState({
    this.store,
    this.loading = true,
    this.error,
    this.selectedCategoryId,
  });

  final Store? store;
  final bool loading;
  final ErrorHandler? error;
  final String? selectedCategoryId;

  List<StoreMenuCategory> get categories => store?.categories ?? const [];

  StoreMenuState copyWith({
    Store? store,
    bool? loading,
    ErrorHandler? error,
    bool clearError = false,
    String? Function()? selectedCategoryId,
  }) => StoreMenuState(
    store: store ?? this.store,
    loading: loading ?? this.loading,
    error: clearError ? null : (error ?? this.error),
    selectedCategoryId: selectedCategoryId == null
        ? this.selectedCategoryId
        : selectedCategoryId(),
  );
}

/// Loads `GET /stores/:id` (header + `categories`) and drives [products]:
/// selecting a section resets the paging to `/products?storeId=&categoryId=`.
/// The first products page starts in parallel with the store, so the page
/// opens with two requests.
class StoreMenuCubit extends Cubit<StoreMenuState> {
  StoreMenuCubit({required this.repository, required this.storeId})
    : super(const StoreMenuState()) {
    products = PagedCubit<Product>(fetcherFor(null));
  }

  final CatalogRepository repository;
  final String storeId;

  /// Products of the selected section (closed with this cubit).
  late final PagedCubit<Product> products;

  @override
  Future<void> close() async {
    await products.close();
    return super.close();
  }

  /// Page fetcher of one section (`null` = every product of the store).
  /// `includeClosed` keeps a closed store's menu readable.
  PageFetcher<Product> fetcherFor(String? categoryId) =>
      (page) => repository.getProducts(
        ProductQuery(
          page: page,
          storeId: storeId,
          categoryId: categoryId,
          includeClosed: true,
        ),
      );

  /// First load: the store and the "All" page together.
  Future<void> start() => Future.wait([load(), products.refresh()]);

  /// Reloads the store. A selected section that disappeared falls back to
  /// "All".
  Future<void> load() async {
    emit(state.copyWith(loading: true, clearError: true));
    final result = await repository.getStore(storeId);
    if (isClosed) return;
    switch (result) {
      case Success(:final data):
        final selected = state.selectedCategoryId;
        final stillThere =
            selected == null || data.categories.any((c) => c.id == selected);
        emit(
          state.copyWith(
            store: data,
            loading: false,
            selectedCategoryId: stillThere ? null : () => null,
          ),
        );
        if (!stillThere) await products.reset(fetcherFor(null));
      case Failure(:final message):
        emit(state.copyWith(loading: false, error: message));
    }
  }

  /// Pull to refresh: the store and the current section.
  Future<void> refresh() => Future.wait([load(), products.refresh()]);

  /// Shows only [categoryId]'s products (`null` = all). Selecting the
  /// current section again does nothing.
  Future<void> select(String? categoryId) async {
    if (categoryId == state.selectedCategoryId) return;
    HapticFeedback.selectionClick();
    emit(state.copyWith(selectedCategoryId: () => categoryId));
    await products.reset(fetcherFor(categoryId));
  }
}
