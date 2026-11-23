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
