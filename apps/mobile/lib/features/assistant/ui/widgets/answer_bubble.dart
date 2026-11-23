import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/text_direction.dart';
import '../../../../core/localization/tr.dart';
import '../../logic/assistant_chat_cubit.dart';

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
        Text(
          message.content,
          textDirection: textDirectionOf(message.content),
          style: AppTextStyles.bodyLarge.copyWith(color: context.textMain),
        ),
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
