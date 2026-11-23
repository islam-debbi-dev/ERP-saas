import 'package:flutter_bloc/flutter_bloc.dart';

import '../models/paginated.dart';
import '../network/api_error.dart';
import '../network/api_result.dart';

enum PagedStatus { initial, loading, ready, failure }

/// Infinite-scroll list state shared by every paginated screen.
class PagedState<T> {
  final PagedStatus status;
  final List<T> items;

  /// Cursor of the next page (null on the first load and on the last page).
  final String? cursor;
  final bool hasMore;
  final bool loadingMore;

  /// Failure of the first page (full-screen error) or of the last
  /// "load more" (inline retry) — [items] tells which.
  final ApiError? error;

  const PagedState({
    this.status = PagedStatus.initial,
    this.items = const [],
    this.cursor,
    this.hasMore = true,
    this.loadingMore = false,
    this.error,
  });

  bool get isFirstLoad =>
      items.isEmpty &&
      (status == PagedStatus.initial || status == PagedStatus.loading);
  bool get isEmpty => status == PagedStatus.ready && items.isEmpty;

  PagedState<T> copyWith({
    PagedStatus? status,
    List<T>? items,
    String? cursor,
    bool? hasMore,
    bool? loadingMore,
    ApiError? error,
    bool clearError = false,
  }) => PagedState(
    status: status ?? this.status,
    items: items ?? this.items,
    cursor: cursor ?? this.cursor,
    hasMore: hasMore ?? this.hasMore,
    loadingMore: loadingMore ?? this.loadingMore,
    error: clearError ? null : (error ?? this.error),
  );
}

/// Fetches one page; [cursor] is null for the first page.
typedef PageFetcher<T> =
    Future<ApiResult<Paginated<T>>> Function(String? cursor);

/// Loads the first page on [refresh] and appends on [loadMore]. Stale responses
/// (a refresh that started after them) are dropped.
class PagedCubit<T> extends Cubit<PagedState<T>> {
  PagedCubit(this._fetch) : super(PagedState<T>());

  PageFetcher<T> _fetch;
  int _generation = 0;

  /// Swaps the query (new filter / search) and reloads from the first page.
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
    final result = await _fetch(null);
    if (isClosed || generation != _generation) return;
    switch (result) {
      case Success(:final data):
        emit(
          PagedState<T>(
            status: PagedStatus.ready,
            items: data.items,
            cursor: data.nextCursor,
            hasMore: data.hasMore,
          ),
        );
      case Failure(:final error):
        emit(state.copyWith(status: PagedStatus.failure, error: error));
    }
  }

  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore) return;
    if (state.status != PagedStatus.ready) return;
    final generation = _generation;
    emit(state.copyWith(loadingMore: true, clearError: true));
    final result = await _fetch(state.cursor);
    if (isClosed || generation != _generation) return;
    switch (result) {
      case Success(:final data):
        emit(
          state.copyWith(
            items: [...state.items, ...data.items],
            cursor: data.nextCursor,
            hasMore: data.hasMore,
            loadingMore: false,
          ),
        );
      case Failure(:final error):
        emit(state.copyWith(loadingMore: false, error: error));
    }
  }

  /// Local edit of one row (e.g. an order the user just cancelled).
  void replaceWhere(bool Function(T item) test, T replacement) => emit(
    state.copyWith(
      items: [for (final item in state.items) test(item) ? replacement : item],
    ),
  );

  /// Local removal of rows (e.g. a conversation the user just deleted).
  void removeWhere(bool Function(T item) test) => emit(
    state.copyWith(items: [...state.items.where((item) => !test(item))]),
  );
}
