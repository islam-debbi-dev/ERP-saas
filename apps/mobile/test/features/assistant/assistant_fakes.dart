import 'dart:async';

import 'package:dio/dio.dart';
import 'package:orvynt_starter/core/models/paginated.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_repository.dart';

ApiError apiError(String code, {Object? details, int status = 400}) => ApiError(
  kind: ApiErrorKind.server,
  code: code,
  message: code,
  details: details,
  statusCode: status,
);

/// One question the fake was asked, and the stream the test feeds.
class FakeChat {
  FakeChat(this.message, this.conversationId, this.token);
  final String message;
  final String? conversationId;
  final CancelToken? token;
  final events = StreamController<AssistantStreamEvent>();

  void add(AssistantStreamEvent event) => events.add(event);
  Future<void> end() => events.close();

  /// The connection drops.
  Future<void> cut() async {
    events.addError(Exception('connection lost'));
    await events.close();
  }
}

/// The assistant API without a network: each `chat` is a [FakeChat] the
/// test drives, or [refusal] before the stream.
class FakeAssistantRepository extends AssistantRepository {
  FakeAssistantRepository() : super(ApiClient(dio: Dio()));

  final chats = <FakeChat>[];
  ApiError? refusal;
  ApiResult<AssistantConversationDetail>? detail;
  ApiResult<Paginated<AssistantConversation>> Function(String? cursor)? pages;
  bool feedbackFails = false;
  bool deleteFails = false;
  final feedbacks = <(String, bool)>[];
  final deleted = <String>[];

  FakeChat get last => chats.last;

  @override
  Future<ApiResult<Stream<AssistantStreamEvent>>> chat({
    required String message,
    String? conversationId,
    CancelToken? cancelToken,
  }) async {
    final chat = FakeChat(message, conversationId, cancelToken);
    chats.add(chat);
    final error = refusal;
    if (error != null) return ApiResult.failure(error);
    // dio ends a cancelled stream with an error, like this.
    unawaited(
      cancelToken?.whenCancel.then((_) async {
        if (chat.events.isClosed) return;
        chat.events.addError(
          DioException.requestCancelled(
            requestOptions: RequestOptions(),
            reason: 'stop',
          ),
        );
        await chat.events.close();
      }),
    );
    return ApiResult.success(chat.events.stream);
  }

  @override
  Future<ApiResult<AssistantConversationDetail>> conversation(
    String id,
  ) async => detail ?? ApiResult.failure(apiError('NOT_FOUND', status: 404));

  @override
  Future<ApiResult<Paginated<AssistantConversation>>> conversations({
    String? cursor,
  }) async =>
      pages?.call(cursor) ??
      const ApiResult.success(Paginated(items: <AssistantConversation>[]));

  @override
  Future<ApiResult<void>> feedback(
    String messageId, {
    required bool useful,
  }) async {
    feedbacks.add((messageId, useful));
    return feedbackFails
        ? ApiResult.failure(apiError('INTERNAL_ERROR', status: 500))
        : const ApiResult.success(null);
  }

  @override
  Future<ApiResult<void>> deleteConversation(String id) async {
    deleted.add(id);
    return deleteFails
        ? ApiResult.failure(apiError('INTERNAL_ERROR', status: 500))
        : const ApiResult.success(null);
  }
}
