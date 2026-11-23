/// The phase 30 assistant's DTOs (`packages/shared/src/schemas/assistant.ts`),
/// read by hand: they are small and only read.
library;

/// `GET /assistant/status`: false hides the entry (flag off, no permission,
/// no provider, read-only session).
class AssistantStatus {
  const AssistantStatus({required this.available, this.provider});

  static const unavailable = AssistantStatus(available: false);

  final bool available;

  /// `ANTHROPIC`, `GEMINI` or `OPENAI_COMPATIBLE`: shown under the input.
  final String? provider;

  factory AssistantStatus.fromJson(Map<String, dynamic> json) =>
      AssistantStatus(
        available: json['available'] == true,
        provider: json['provider'] as String?,
      );
}

/// A link offered with an answer. [href] is a **web path** (`/clients/:id`);
/// `AssistantLinks` maps it to an app screen or the dashboard.
class AssistantLink {
  const AssistantLink({required this.label, required this.href});

  final String label;
  final String href;

  factory AssistantLink.fromJson(Map<String, dynamic> json) => AssistantLink(
    label: json['label'] as String? ?? '',
    href: json['href'] as String? ?? '',
  );

  static List<AssistantLink> listOf(Object? json) => [
    for (final e in (json as List<dynamic>? ?? const []))
      AssistantLink.fromJson(e as Map<String, dynamic>),
  ];
}

/// One row of `GET /assistant/conversations`.
class AssistantConversation {
  const AssistantConversation({
    required this.id,
    required this.title,
    required this.createdAt,
  });

  final String id;
  final String title;
  final DateTime createdAt;

  factory AssistantConversation.fromJson(Map<String, dynamic> json) =>
      AssistantConversation(
        id: json['id'] as String,
        title: json['title'] as String? ?? '',
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// A stored message of `GET /assistant/conversations/:id`.
class AssistantMessage {
  const AssistantMessage({
    required this.id,
    required this.fromUser,
    required this.content,
    this.links = const [],
    this.useful,
  });

  final String id;

  /// `role: USER` (else `ASSISTANT`).
  final bool fromUser;
  final String content;
  final List<AssistantLink> links;
  final bool? useful;

  factory AssistantMessage.fromJson(Map<String, dynamic> json) =>
      AssistantMessage(
        id: json['id'] as String,
        fromUser: json['role'] == 'USER',
        content: json['content'] as String? ?? '',
        links: AssistantLink.listOf(json['links']),
        useful: json['useful'] as bool?,
      );
}

/// `GET /assistant/conversations/:id`.
class AssistantConversationDetail {
  const AssistantConversationDetail({required this.id, required this.messages});

  final String id;
  final List<AssistantMessage> messages;

  factory AssistantConversationDetail.fromJson(Map<String, dynamic> json) =>
      AssistantConversationDetail(
        id: json['id'] as String,
        messages: [
          for (final m in (json['messages'] as List<dynamic>? ?? const []))
            AssistantMessage.fromJson(m as Map<String, dynamic>),
        ],
      );
}

/// What `POST /assistant/chat` streams, one JSON object per SSE `data:`
/// event (`AssistantStreamEvent` in the shared schema).
sealed class AssistantStreamEvent {
  const AssistantStreamEvent();

  /// Null for a type the app does not know (a newer API): it is skipped.
  static AssistantStreamEvent? fromJson(Map<String, dynamic> json) =>
      switch (json['type']) {
        'conversation' => AssistantConversationEvent(
          json['conversationId'] as String,
        ),
        'text' => AssistantTextEvent(json['delta'] as String? ?? ''),
        'replace' => AssistantReplaceEvent(json['text'] as String? ?? ''),
        'tool' => AssistantToolEvent(json['name'] as String? ?? ''),
        'links' => AssistantLinksEvent(AssistantLink.listOf(json['links'])),
        'done' => AssistantDoneEvent(
          messageId: json['messageId'] as String,
          conversationId: json['conversationId'] as String?,
          truncated: json['truncated'] == true,
        ),
        'error' => AssistantErrorEvent(
          json['code'] as String? ?? 'AI_UNAVAILABLE',
        ),
        _ => null,
      };
}

class AssistantConversationEvent extends AssistantStreamEvent {
  const AssistantConversationEvent(this.conversationId);
  final String conversationId;
}

/// Append [delta] to the answer.
class AssistantTextEvent extends AssistantStreamEvent {
  const AssistantTextEvent(this.delta);
  final String delta;
}

/// What was streamed so far must not stand: show [text] instead.
class AssistantReplaceEvent extends AssistantStreamEvent {
  const AssistantReplaceEvent(this.text);
  final String text;
}

/// The assistant is reading data with tool [name] (`search_clients`...).
class AssistantToolEvent extends AssistantStreamEvent {
  const AssistantToolEvent(this.name);
  final String name;
}

class AssistantLinksEvent extends AssistantStreamEvent {
  const AssistantLinksEvent(this.links);
  final List<AssistantLink> links;
}

class AssistantDoneEvent extends AssistantStreamEvent {
  const AssistantDoneEvent({
    required this.messageId,
    this.conversationId,
    this.truncated = false,
  });
  final String messageId;
  final String? conversationId;
  final bool truncated;
}

/// The provider failed after the stream started ([code] is an `ErrorCode`).
class AssistantErrorEvent extends AssistantStreamEvent {
  const AssistantErrorEvent(this.code);
  final String code;
}
