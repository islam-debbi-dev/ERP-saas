import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/idempotency_key.dart';
import '../models/payment.dart';

/// Versements: create (@Idempotent), my versements, one versement.
class PaymentsRepository {
  PaymentsRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<Payment>> create(
    Map<String, dynamic> body,
    IdempotencyKey key,
  ) => _api.post(
    '/payments',
    data: body,
    idempotencyKey: key,
    decode: (json) => Payment.fromJson(json.asMap),
  );

  /// What [collectorId] collected, newest first.
  Future<ApiResult<Paginated<Payment>>> collectedBy(
    String collectorId, {
    String? cursor,
  }) => _api.get(
    '/payments',
    query: {'collectedBy': collectorId, 'cursor': cursor, 'limit': 30},
    decode: (json) => Paginated.fromJson(json.asMap, Payment.fromJson),
  );

  Future<ApiResult<Payment>> get(String id) =>
      _api.get('/payments/$id', decode: (json) => Payment.fromJson(json.asMap));
}
