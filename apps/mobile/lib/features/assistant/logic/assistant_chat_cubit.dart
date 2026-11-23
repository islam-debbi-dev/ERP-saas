import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../data/assistant_models.dart';
import '../data/assistant_repository.dart';

/// Where the conversation on screen stands.
/// - [idle]: nothing asked yet (new or just opened conversation);
/// - [streaming]: an answer is coming (send is replaced by stop);
/// - [done]: the last answer came whole;
/// - [error]: refused, failed or cut ([AssistantChatState.failure]);
/// - [cancelled]: the user stopped it.
enum ChatPhase { idle, streaming, done, error, cancelled }

/// The tools of the shared schema (`ASSISTANT_TOOLS`), each with an
/// `assistant.tool.<name>` string. Another name shows "thinking".
const assistantToolNames = {
  'search_clients',
  'client_balance',
  'search_products',
  'product_stock',
  'sales_summary',
  'clients_to_remind',
  'find_document',
};

/// One bubble. [id] is null until the API gives the stored id (`done`).
class ChatMessage {
  const ChatMessage({
    required this.key,
    required this.fromUser,
    required this.content,
    this.id,
    this.links = const [],
    this.useful,
    this.truncated = false,
  });

  final int key;
  final String? id;
  final bool fromUser;
  final String content;
  final List<AssistantLink> links;
  final bool? useful;
  final bool truncated;

  ChatMessage copyWith({
    String? id,
    String? content,
    List<AssistantLink>? links,
    bool? useful,
    bool clearUseful = false,
    bool? truncated,
  }) => ChatMessage(
    key: key,
    id: id ?? this.id,
    fromUser: fromUser,
    content: content ?? this.content,
    links: links ?? this.links,
    useful: clearUseful ? null : (useful ?? this.useful),
    truncated: truncated ?? this.truncated,
  );
}

/// Why the last question failed: an [error] from the API (refused before
/// the stream, or an `error` event), or a stream [cut] with no `done`.
class ChatFailure {
  const ChatFailure.api(ApiError this.error) : cut = false;
  const ChatFailure.cut() : error = null, cut = true;

  final ApiError? error;
  final bool cut;

  /// The first day of next month (`YYYY-MM-DD`), on a spent monthly quota.
  String? get resetDate {
    final date = error?.detail('resetDate');
    return date is String ? date : null;
  }
}

class AssistantChatState {
  const AssistantChatState({
    this.messages = const [],
    this.conversationId,
    this.phase = ChatPhase.idle,
    this.tool,
    this.failure,
    this.lastQuestion,
    this.opening = false,
    this.feedbackFailures = 0,
  });

  final List<ChatMessage> messages;
  final String? conversationId;
  final ChatPhase phase;

  /// The tool the assistant is using right now (cleared by the next text).
  final String? tool;
  final ChatFailure? failure;

  /// What [AssistantChatCubit.retry] sends again.
  final String? lastQuestion;

  /// A stored conversation is loading.
  final bool opening;

  /// Grows on each 👍 / 👎 the API did not save, so the screen tells once.
  final int feedbackFailures;

  bool get streaming => phase == ChatPhase.streaming;

  /// Streaming and nothing written yet: "thinking" or the tool line shows.
  bool get waiting =>
      streaming && messages.isNotEmpty && messages.last.content.isEmpty;

  AssistantChatState copyWith({
    List<ChatMessage>? messages,
    String? conversationId,
    bool clearConversation = false,
    ChatPhase? phase,
    String? tool,
    bool clearTool = false,
    ChatFailure? failure,
    bool clearFailure = false,
    String? lastQuestion,
    bool? opening,
    int? feedbackFailures,
  }) => AssistantChatState(
    messages: messages ?? this.messages,
    conversationId: clearConversation
        ? null
        : (conversationId ?? this.conversationId),
    phase: phase ?? this.phase,
    tool: clearTool ? null : (tool ?? this.tool),
    failure: clearFailure ? null : (failure ?? this.failure),
    lastQuestion: lastQuestion ?? this.lastQuestion,
    opening: opening ?? this.opening,
    feedbackFailures: feedbackFailures ?? this.feedbackFailures,
  );
}

/// One conversation on screen, as the web's `useAssistantChat`
/// (`apps/web/src/lib/assistant.ts`). The phone only sends the question:
/// what the assistant may read is decided on the server.
///
/// Closing the cubit (leaving the screen) cancels the request in flight.
class AssistantChatCubit extends Cubit<AssistantChatState> {
  AssistantChatCubit(this._repo) : super(const AssistantChatState());

  final AssistantRepository _repo;
  CancelToken? _token;
  int _nextKey = 0;

  /// Asks [text]. Resolves false when nothing came back, so the screen can
  /// put the question back in the input.
  Future<bool> send(String text) async {
    final question = text.trim();
    if (question.isEmpty || state.streaming) return false;
    final token = CancelToken();
    _token = token;
    final isNew = state.conversationId == null;
    emit(
      state.copyWith(
        messages: [
          ...state.messages,
          ChatMessage(key: _nextKey++, fromUser: true, content: question),
          ChatMessage(key: _nextKey++, fromUser: false, content: ''),
        ],
        phase: ChatPhase.streaming,
        clearTool: true,
        clearFailure: true,
        lastQuestion: question,
      ),
    );

    final result = await _repo.chat(
      message: question,
      conversationId: state.conversationId,
      cancelToken: token,
    );
    if (isClosed || token != _token) return false;

    ApiError? failed;
    var finished = false;
    switch (result) {
      case Failure(:final error):
        failed = error;
      case Success(data: final events):
        try {
          await for (final event in events) {
            if (isClosed || token != _token) return false;
            switch (event) {
              case AssistantErrorEvent(:final code):
                failed = ApiError(
                  kind: ApiErrorKind.server,
                  code: code,
                  message: code,
                );
              case AssistantDoneEvent():
                finished = true;
                _apply(event);
              default:
                _apply(event);
            }
          }
        } catch (_) {
          // Cancelled, or the connection dropped: told apart below.
        }
    }
    if (isClosed || token != _token) return false;
    return _end(
      cancelled: token.isCancelled,
      failed: failed,
      finished: finished,
      isNew: isNew,
    );
  }

  void _apply(AssistantStreamEvent event) {
    switch (event) {
      case AssistantConversationEvent(:final conversationId):
        emit(state.copyWith(conversationId: conversationId));
      case AssistantTextEvent(:final delta):
        _patchAnswer((m) => m.copyWith(content: m.content + delta));
      case AssistantReplaceEvent(:final text):
        _patchAnswer((m) => m.copyWith(content: text));
      case AssistantToolEvent(:final name):
        emit(state.copyWith(tool: name));
      case AssistantLinksEvent(:final links):
        _patchAnswer((m) => m.copyWith(links: links), keepTool: true);
      case AssistantDoneEvent(:final messageId, :final truncated):
        _patchAnswer(
          (m) => m.copyWith(id: messageId, truncated: truncated),
          keepTool: true,
        );
      case AssistantErrorEvent():
        break;
    }
  }

  /// Changes the answer being written, always the last message. Text
  /// clears the tool line.
  void _patchAnswer(
    ChatMessage Function(ChatMessage) patch, {
    bool keepTool = false,
  }) {
    final list = [...state.messages];
    if (list.isEmpty || list.last.fromUser) return;
    list[list.length - 1] = patch(list.last);
    emit(state.copyWith(messages: list, clearTool: !keepTool));
  }

  bool _end({
    required bool cancelled,
    required ApiError? failed,
    required bool finished,
    required bool isNew,
  }) {
    final answered =
        state.messages.isNotEmpty &&
        !state.messages.last.fromUser &&
        state.messages.last.content.isNotEmpty;
    var messages = state.messages;

    if (cancelled) {
      // The API kept the question (and what it wrote); an empty bubble goes.
      if (!answered) messages = _withoutEmptyAnswer(messages);
      emit(
        state.copyWith(
          messages: messages,
          phase: ChatPhase.cancelled,
          clearTool: true,
        ),
      );
      return answered;
    }

    if (failed != null) {
      if (!answered) {
        // The API forgot the question, and a new conversation with it.
        messages = messages.sublist(0, messages.length - 2);
      }
      emit(
        state.copyWith(
          messages: messages,
          phase: ChatPhase.error,
          failure: ChatFailure.api(failed),
          clearTool: true,
          clearConversation: !answered && isNew,
        ),
      );
      return answered;
    }

    if (!finished) {
      // Cut: no `done`. The API keeps a question whose client left.
      if (!answered) messages = _withoutEmptyAnswer(messages);
      emit(
        state.copyWith(
          messages: messages,
          phase: ChatPhase.error,
          failure: const ChatFailure.cut(),
          clearTool: true,
        ),
      );
      return answered;
    }

    emit(state.copyWith(phase: ChatPhase.done, clearTool: true));
    return true;
  }

  static List<ChatMessage> _withoutEmptyAnswer(List<ChatMessage> list) =>
      list.isNotEmpty && !list.last.fromUser && list.last.content.isEmpty
      ? list.sublist(0, list.length - 1)
      : list;

  /// Asks the last question again. A question left without its answer (a
  /// cut) is not shown twice.
  Future<bool> retry() {
    final question = state.lastQuestion;
    if (question == null || state.streaming) return Future.value(false);
    final list = state.messages;
    if (list.isNotEmpty && list.last.fromUser) {
      emit(state.copyWith(messages: list.sublist(0, list.length - 1)));
    }
    return send(question);
  }

  /// Stops the answer being written.
  void stop() => _token?.cancel();

  /// A new conversation.
  void reset() {
    _cancel();
    emit(const AssistantChatState());
  }

  /// Opens a stored conversation.
  Future<void> open(String id) async {
    _cancel();
    emit(
      AssistantChatState(
        conversationId: id,
        opening: true,
        feedbackFailures: state.feedbackFailures,
      ),
    );
    final result = await _repo.conversation(id);
    if (isClosed || state.conversationId != id) return;
    switch (result) {
      case Success(:final data):
        emit(
          state.copyWith(
            opening: false,
            messages: [
              for (final m in data.messages)
                ChatMessage(
                  key: _nextKey++,
                  id: m.id,
                  fromUser: m.fromUser,
                  content: m.content,
                  links: m.links,
                  useful: m.useful,
                ),
            ],
          ),
        );
      case Failure(:final error):
        emit(
          AssistantChatState(
            phase: ChatPhase.error,
            failure: ChatFailure.api(error),
            feedbackFailures: state.feedbackFailures,
          ),
        );
    }
  }

  /// The conversation [id] was deleted from the history.
  void forget(String id) {
    if (state.conversationId == id) reset();
  }

  /// 👍 / 👎 on a stored answer. Shown at once; put back if the API
  /// did not save it.
  Future<void> rate(String messageId, {required bool useful}) async {
    final before = state.messages
        .where((m) => m.id == messageId)
        .firstOrNull
        ?.useful;
    _setUseful(messageId, useful);
    final result = await _repo.feedback(messageId, useful: useful);
    if (isClosed || result is Success) return;
    _setUseful(messageId, before);
    emit(state.copyWith(feedbackFailures: state.feedbackFailures + 1));
  }

  void _setUseful(String messageId, bool? useful) => emit(
    state.copyWith(
      messages: [
        for (final m in state.messages)
          m.id == messageId
              ? m.copyWith(useful: useful, clearUseful: useful == null)
              : m,
      ],
    ),
  );

  void _cancel() {
    _token?.cancel();
    _token = null;
  }

  @override
  Future<void> close() {
    _cancel();
    return super.close();
  }
}
