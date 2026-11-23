import 'dart:convert';

import 'package:dio/dio.dart';

import '../../../core/models/paginated.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import 'assistant_models.dart';
import 'sse_parser.dart';

/// The phase 30 assistant API (`apps/api/src/assistant/assistant.controllers.ts`).
/// The data scope stays on the server: the app only sends the question.
class AssistantRepository {
  AssistantRepository(this._api);

  final ApiClient _api;

  /// A tool round can stay silent longer than the app's usual 30 s.
  static const chatReceiveTimeout = Duration(seconds: 120);

  Future<ApiResult<AssistantStatus>> status() => _api.get(
    '/assistant/status',
    decode: (json) => AssistantStatus.fromJson(json.asMap),
  );

  /// `POST /assistant/chat`, SSE over POST. Every refusal (quota, daily
  /// limit, rate limit, no provider) comes before the first byte as a normal
  /// JSON error, so it is a [Failure] here. After that, only events: a cut
  /// shows as a stream that ends (or throws) without a `done`.
  /// [cancelToken] stops the request; the stream then throws a cancel.
  Future<ApiResult<Stream<AssistantStreamEvent>>> chat({
    required String message,
    String? conversationId,
    CancelToken? cancelToken,
  }) async {
    try {
      final response = await _api.dio.post<ResponseBody>(
        '/assistant/chat',
        data: {'message': message, 'conversationId': ?conversationId},
        options: Options(
          responseType: ResponseType.stream,
          receiveTimeout: chatReceiveTimeout,
          headers: {'Accept': 'text/event-stream'},
        ),
        cancelToken: cancelToken,
      );
      final body = response.data;
      if (body == null) return ApiResult.failure(ApiError.unexpected());
      return ApiResult.success(decodeAssistantSse(body.stream));
    } on DioException catch (e) {
      final response = e.response;
      final data = response?.data;
      if (response == null || data is! ResponseBody) {
        return ApiResult.failure(ApiError.fromDio(e));
      }
      // The error body `{ code, message, details }` arrives as a byte stream.
      Object? json;
      try {
        final bytes = await data.stream.fold<List<int>>(
          <int>[],
          (all, chunk) => all..addAll(chunk),
        );
        json = jsonDecode(utf8.decode(bytes));
      } catch (_) {
        json = null;
      }
      return ApiResult.failure(
        ApiError.fromResponse(
          Response<Object?>(
            requestOptions: e.requestOptions,
            statusCode: response.statusCode,
            data: json,
          ),
        ),
      );
    }
  }

  Future<ApiResult<Paginated<AssistantConversation>>> conversations({
    String? cursor,
  }) => _api.get(
    '/assistant/conversations',
    query: {'limit': 30, 'cursor': cursor},
    decode: (json) =>
        Paginated.fromJson(json.asMap, AssistantConversation.fromJson),
  );

  Future<ApiResult<AssistantConversationDetail>> conversation(String id) =>
      _api.get(
        '/assistant/conversations/$id',
        decode: (json) => AssistantConversationDetail.fromJson(json.asMap),
      );

  Future<ApiResult<void>> deleteConversation(String id) =>
      _api.delete('/assistant/conversations/$id', decode: (_) {});

  Future<ApiResult<void>> feedback(String messageId, {required bool useful}) =>
      _api.post(
        '/assistant/messages/$messageId/feedback',
        data: {'useful': useful},
        decode: (_) {},
      );
}
