import 'package:flutter_bloc/flutter_bloc.dart';

import '../service/api_error_handler.dart';
import '../service/api_result.dart';

/// State of a single-resource screen (product, store, order detail).
class LoadState<T> {
  final T? data;
  final bool loading;
  final ErrorHandler? error;

  const LoadState({this.data, this.loading = true, this.error});
}

/// Loads one resource; keeps the previous data visible while reloading.
class LoadCubit<T> extends Cubit<LoadState<T>> {
  LoadCubit(this._fetch) : super(LoadState<T>());

  final Future<ApiResult<T>> Function() _fetch;

  Future<void> load() async {
    emit(LoadState<T>(data: state.data));
    final result = await _fetch();
    if (isClosed) return;
    switch (result) {
      case Success(:final data):
        emit(LoadState<T>(data: data, loading: false));
      case Failure(:final message):
        emit(LoadState<T>(data: state.data, loading: false, error: message));
    }
  }

  /// Local replacement (e.g. the order returned by a cancel call).
  void set(T data) => emit(LoadState<T>(data: data, loading: false));
}
