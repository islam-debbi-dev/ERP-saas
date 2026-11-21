import 'package:flutter_bloc/flutter_bloc.dart';

import '../models/paginated.dart';
import '../service/api_error_handler.dart';
import '../service/api_result.dart';

enum PagedStatus { initial, loading, ready, failure }

/// Infinite-scroll list state shared by every paginated screen.
class PagedState<T> {
  final PagedStatus status;
  final List<T> items;
  final int page;
  final bool hasMore;
  final bool loadingMore;
  final int total;

  /// Failure of the first page (full-screen error) or of the last
  /// "load more" (inline retry) — [items] tells which.
  final ErrorHandler? error;

  const PagedState({
    this.status = PagedStatus.initial,
    this.items = const [],
    this.page = 0,
    this.hasMore = true,
    this.loadingMore = false,
    this.total = 0,
    this.error,
  });

  bool get isFirstLoad =>
      items.isEmpty &&
      (status == PagedStatus.initial || status == PagedStatus.loading);
  bool get isEmpty => status == PagedStatus.ready && items.isEmpty;

  PagedState<T> copyWith({
    PagedStatus? status,
    List<T>? items,
    int? page,
    bool? hasMore,
    bool? loadingMore,
    int? total,
    ErrorHandler? error,
    bool clearError = false,
  }) => PagedState(
    status: status ?? this.status,
    items: items ?? this.items,
    page: page ?? this.page,
    hasMore: hasMore ?? this.hasMore,
    loadingMore: loadingMore ?? this.loadingMore,
    total: total ?? this.total,
    error: clearError ? null : (error ?? this.error),
  );
}

typedef PageFetcher<T> = Future<ApiResult<Paginated<T>>> Function(int page);

/// Loads page 1 on [refresh] and appends on [loadMore]. Stale responses
/// (a refresh that started after them) are dropped.
class PagedCubit<T> extends Cubit<PagedState<T>> {
  PagedCubit(this._fetch) : super(PagedState<T>());

  PageFetcher<T> _fetch;
  int _generation = 0;

  /// Swaps the query (new filter / search) and reloads from page 1.
  Future<void> reset(PageFetcher<T> fetch) {
    _fetch = fetch;
    emit(PagedState<T>(status: PagedStatus.loading));
    return refresh();
  }

  /// Back to the untouched initial state; responses still in flight are
  /// dropped.
  void clear() {
    _generation++;
    emit(PagedState<T>());
  }

  Future<void> refresh() async {
    final generation = ++_generation;
    if (state.items.isEmpty) {
      emit(state.copyWith(status: PagedStatus.loading, clearError: true));
    }
    final result = await _fetch(1);
    if (isClosed || generation != _generation) return;
    switch (result) {
      case Success(:final data):
        emit(
          PagedState<T>(
            status: PagedStatus.ready,
            items: data.items,
            page: data.page,
            hasMore: data.hasMore,
            total: data.total,
          ),
        );
      case Failure(:final message):
        emit(state.copyWith(status: PagedStatus.failure, error: message));
    }
  }

  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore) return;
    if (state.status != PagedStatus.ready) return;
    final generation = _generation;
    emit(state.copyWith(loadingMore: true, clearError: true));
    final result = await _fetch(state.page + 1);
    if (isClosed || generation != _generation) return;
    switch (result) {
      case Success(:final data):
        emit(
          state.copyWith(
            items: [...state.items, ...data.items],
            page: data.page,
            hasMore: data.hasMore,
            total: data.total,
            loadingMore: false,
          ),
        );
      case Failure(:final message):
        emit(state.copyWith(loadingMore: false, error: message));
    }
  }

  /// Local edit of one row (e.g. an order the user just cancelled).
  void replaceWhere(bool Function(T item) test, T replacement) => emit(
    state.copyWith(
      items: [for (final item in state.items) test(item) ? replacement : item],
    ),
  );
}
