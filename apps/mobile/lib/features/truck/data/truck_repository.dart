import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import 'models/me_day.dart';

/// The user's own day on the road: `GET /me/day` (phase 39, A2).
class TruckRepository {
  TruckRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<MeDay>> myDay() =>
      _api.get('/me/day', decode: (json) => MeDay.fromJson(json.asMap));
}
