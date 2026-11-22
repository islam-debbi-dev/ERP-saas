import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../models/today.dart';

/// The seller's day: `GET /me/today` (TOURNEES).
class TodayRepository {
  TodayRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<Today>> today() =>
      _api.get('/me/today', decode: (json) => Today.fromJson(json.asMap));
}
