import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import 'assistant_models.dart';

/// The phase 30 assistant API (`apps/api/src/assistant/assistant.controllers.ts`).
/// The data scope stays on the server: the app only sends the question.
class AssistantRepository {
  AssistantRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<AssistantStatus>> status() => _api.get(
    '/assistant/status',
    decode: (json) => AssistantStatus.fromJson(json.asMap),
  );
}
