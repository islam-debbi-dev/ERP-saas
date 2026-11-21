import 'api_error.dart';

/// Result of an API call: [Success] with the decoded value or [Failure] with
/// the [ApiError]. Switch on it:
///
/// ```dart
/// switch (await repo.load()) {
///   case Success(:final data): ...
///   case Failure(:final error): ...
/// }
/// ```
sealed class ApiResult<T> {
  const ApiResult();

  const factory ApiResult.success(T data) = Success<T>;
  const factory ApiResult.failure(ApiError error) = Failure<T>;
}

final class Success<T> extends ApiResult<T> {
  const Success(this.data);
  final T data;
}

final class Failure<T> extends ApiResult<T> {
  const Failure(this.error);
  final ApiError error;
}
