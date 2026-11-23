import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/text_direction.dart';
import '../../../../core/localization/tr.dart';
import '../../logic/assistant_chat_cubit.dart';
import 'assistant_markdown_view.dart';

/// The user's question: a bubble on the end side, in its own direction.
class QuestionBubble extends StatelessWidget {
  const QuestionBubble({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Align(
      alignment: AlignmentDirectional.centerEnd,
      child: Container(
        margin: const EdgeInsetsDirectional.only(start: AppSpacing.xxl),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: theme.colorScheme.primary.withValues(alpha: 0.12),
          borderRadius: AppRadius.mdAll,
        ),
        child: Text(
          message.content,
          textDirection: textDirectionOf(message.content),
          style: AppTextStyles.bodyLarge.copyWith(color: context.textMain),
        ),
      ),
    );
  }
}

/// An answer of the assistant: its text, "réponse tronquée" when the API
/// cut it, then [footer] (links, feedback).
class AnswerBubble extends StatelessWidget {
  const AnswerBubble({super.key, required this.message, this.footer});

  final ChatMessage message;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AssistantMarkdownView(text: message.content),
        if (message.truncated) ...[
          const SizedBox(height: AppSpacing.xs),
          Text(
            context.tr('assistant.truncated'),
            style: AppTextStyles.caption.copyWith(color: context.textMuted),
          ),
        ],
        ?footer,
      ],
    );
  }
}

/// 👍 / 👎 under a stored answer (48 dp each); the chosen one is filled.
class FeedbackButtons extends StatelessWidget {
  const FeedbackButtons({
    super.key,
    required this.useful,
    required this.onRate,
  });

  final bool? useful;
  final ValueChanged<bool> onRate;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    Widget button(bool value, IconData off, IconData on, String label) =>
        IconButton(
          key: Key('assistant-${value ? 'useful' : 'not-useful'}'),
          tooltip: context.tr(label),
          isSelected: useful == value,
          constraints: const BoxConstraints(
            minWidth: AppSpacing.minTouch,
            minHeight: AppSpacing.minTouch,
          ),
          color: context.textMuted,
          selectedIcon: Icon(on, color: primary),
          onPressed: () => onRate(value),
          icon: Icon(off),
        );
    return Row(
      children: [
        button(
          true,
          Icons.thumb_up_outlined,
          Icons.thumb_up,
          'assistant.useful',
        ),
        button(
          false,
          Icons.thumb_down_outlined,
          Icons.thumb_down,
          'assistant.not_useful',
        ),
      ],
    );
  }
}
