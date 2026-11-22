import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';

/// The saved visit (the fields the phone needs back).
class VisitSaved {
  const VisitSaved({required this.id, required this.outcome, this.geoStatus});

  final String id;
  final String outcome;
  final String? geoStatus;

  factory VisitSaved.fromJson(Map<String, dynamic> json) => VisitSaved(
    id: json['id'] as String,
    outcome: json['outcome'] as String,
    geoStatus:
        (json['geoCheck'] as Map<String, dynamic>?)?['status'] as String?,
  );
}

/// `POST /visits` (@Idempotent, TOURNEES).
class VisitsRepository {
  VisitsRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<VisitSaved>> create(
    Map<String, dynamic> body,
    IdempotencyKey key,
  ) => _api.post(
    '/visits',
    data: body,
    idempotencyKey: key,
    decode: (json) => VisitSaved.fromJson(json.asMap),
  );
}
