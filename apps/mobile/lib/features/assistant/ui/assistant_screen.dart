import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/text_direction.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/session/session_cubit.dart';
import '../data/assistant_repository.dart';
import '../logic/assistant_chat_cubit.dart';
import '../logic/assistant_status_cubit.dart';
import 'assistant_history_screen.dart';
import 'widgets/answer_bubble.dart';
import 'widgets/chat_input_bar.dart';

/// The assistant (phase 30 API), a sub-page of each role's "Plus": the
/// bottom bar hides by itself (#85). Leaving the screen closes the cubit,
/// which cancels an answer still streaming.
class AssistantScreen extends StatelessWidget {
  const AssistantScreen({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
    create: (_) => AssistantChatCubit(getIt<AssistantRepository>()),
    child: const _AssistantView(),
  );
}

class _AssistantView extends StatefulWidget {
  const _AssistantView();

  @override
  State<_AssistantView> createState() => _AssistantViewState();
}

class _AssistantViewState extends State<_AssistantView> {
  final _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _ask(String text) async {
    final question = text.trim();
    final cubit = context.read<AssistantChatCubit>();
    if (question.isEmpty || cubit.state.streaming) return;
    _input.clear();
    final answered = await cubit.send(question);
    // Nothing came back: the question goes back in the box, as on the web.
    if (!answered && mounted && _input.text.isEmpty) _input.text = question;
  }

  Future<void> _retry() async {
    _input.clear();
    await context.read<AssistantChatCubit>().retry();
  }

  Future<void> _openHistory() async {
    final cubit = context.read<AssistantChatCubit>();
    final result = await Navigator.of(context).push<HistoryResult>(
      MaterialPageRoute(builder: (_) => const AssistantHistoryScreen()),
    );
    if (result == null || !mounted) return;
    result.deleted.forEach(cubit.forget);
    final open = result.open;
    if (open != null) {
      _input.clear();
      await cubit.open(open);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AssistantStatusCubit>().state.provider;
    final chat = context.watch<AssistantChatCubit>();
    final state = chat.state;
    return BlocListener<AssistantChatCubit, AssistantChatState>(
      listenWhen: (a, b) => b.feedbackFailures > a.feedbackFailures,
      listener: (context, _) => ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('assistant.feedback_failed'))),
      ),
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.tr('assistant.title')),
          actions: [
            IconButton(
              tooltip: context.tr('assistant.new_conversation'),
              onPressed: state.messages.isEmpty && state.failure == null
                  ? null
                  : () {
                      _input.clear();
                      chat.reset();
                    },
              icon: const Icon(Icons.add_comment_outlined),
            ),
            IconButton(
              key: const Key('assistant-history'),
              tooltip: context.tr('assistant.history'),
              onPressed: _openHistory,
              icon: const Icon(Icons.history),
            ),
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: state.opening
                  ? const Center(child: CircularProgressIndicator())
                  : state.messages.isEmpty
                  ? _Empty(
                      failure: state.failure,
                      onAsk: _ask,
                      onRetry: state.lastQuestion == null ? null : _retry,
                    )
                  : _Messages(state: state, onRetry: _retry),
            ),
            ChatInputBar(
              controller: _input,
              streaming: state.streaming,
              provider: provider,
              onSend: () => _ask(_input.text),
              onStop: chat.stop,
            ),
          ],
        ),
      ),
    );
  }
}

/// The conversation, newest at the bottom (a reversed list stays pinned
/// to the end while the answer grows).
class _Messages extends StatelessWidget {
  const _Messages({required this.state, required this.onRetry});

  final AssistantChatState state;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final items = <Widget>[
      for (final m in state.messages)
        if (m.fromUser)
          QuestionBubble(message: m)
        else if (m.content.isNotEmpty)
          AnswerBubble(
            message: m,
            footer: m.id == null
                ? null
                : FeedbackButtons(
                    useful: m.useful,
                    onRate: (useful) => context.read<AssistantChatCubit>().rate(
                      m.id!,
                      useful: useful,
                    ),
                  ),
          ),
      if (state.waiting || (state.streaming && state.tool != null))
        _StatusLine(tool: state.tool),
      if (state.failure != null)
        FailureCard(failure: state.failure!, onRetry: onRetry),
    ];
    return ListView.separated(
      reverse: true,
      padding: const EdgeInsets.all(AppSpacing.lg),
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.lg),
      itemBuilder: (_, i) => items[items.length - 1 - i],
    );
  }
}

/// "Je réfléchis…", or what the assistant is reading ("Je consulte le
/// compte du client…").
class _StatusLine extends StatelessWidget {
  const _StatusLine({this.tool});

  final String? tool;

  @override
  Widget build(BuildContext context) {
    final key = tool != null && assistantToolNames.contains(tool)
        ? 'assistant.tool.$tool'
        : 'assistant.thinking';
    return Row(
      children: [
        const SizedBox.square(
          dimension: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            context.tr(key),
            style: AppTextStyles.body.copyWith(color: context.textMuted),
          ),
        ),
      ],
    );
  }
}

/// Why the question failed, translated, with *Réessayer*. A spent monthly
/// quota says when the questions come back.
class FailureCard extends StatelessWidget {
  const FailureCard({super.key, required this.failure, this.onRetry});

  final ChatFailure failure;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final error = failure.error;
    var text = error == null
        ? context.tr('assistant.stream_cut')
        : apiErrorText(context, error);
    final reset = failure.resetDate;
    if (reset != null) {
      text =
          '$text ${context.tr('assistant.quota_reset', args: {'date': AlgiersDay.display(reset)})}';
    }
    return Container(
      key: const Key('assistant-failure'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.error.withValues(alpha: 0.08),
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: scheme.error.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            text,
            style: AppTextStyles.body.copyWith(color: context.textMain),
          ),
          if (onRetry != null)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, AppSpacing.minTouch),
                ),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(context.tr('common.retry')),
              ),
            ),
        ],
      ),
    );
  }
}

/// Nothing asked yet: a few questions for the user's role, or the failure
/// of a first question.
class _Empty extends StatelessWidget {
  const _Empty({required this.failure, required this.onAsk, this.onRetry});

  final ChatFailure? failure;
  final ValueChanged<String> onAsk;
  final VoidCallback? onRetry;

  static const _suggestions = {
    Role.seller: ['seller_sales', 'seller_remind', 'seller_howto'],
    Role.livreur: ['livreur_deliver', 'livreur_collect', 'livreur_document'],
    Role.supervisor: [
      'supervisor_sales',
      'supervisor_remind',
      'supervisor_howto',
    ],
    Role.storekeeper: [
      'storekeeper_stock',
      'storekeeper_load',
      'storekeeper_count',
    ],
  };

  @override
  Widget build(BuildContext context) {
    final role = context.watch<SessionCubit>().state.user?.role;
    final keys = _suggestions[role] ?? const <String>[];
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        if (failure != null) ...[
          FailureCard(failure: failure!, onRetry: onRetry),
          const SizedBox(height: AppSpacing.lg),
        ],
        Icon(
          Icons.auto_awesome_outlined,
          size: 32,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(context.tr('assistant.empty_title'), style: AppTextStyles.h3),
        const SizedBox(height: AppSpacing.xs),
        Text(
          context.tr('assistant.empty_help'),
          style: AppTextStyles.body.copyWith(color: context.textMuted),
        ),
        const SizedBox(height: AppSpacing.lg),
        for (final key in keys)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: Builder(
                builder: (context) {
                  final text = context.tr('assistant.suggest.$key');
                  return OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, AppSpacing.minTouch),
                      alignment: AlignmentDirectional.centerStart,
                    ),
                    onPressed: () => onAsk(text),
                    child: Text(text, textDirection: textDirectionOf(text)),
                  );
                },
              ),
            ),
          ),
      ],
    );
  }
}

/// "Les réponses sont générées par une IA : {provider}…", under the input
/// like the web.
class ProviderNotice extends StatelessWidget {
  const ProviderNotice({super.key, required this.provider});

  final String? provider;

  @override
  Widget build(BuildContext context) {
    final name = provider == null
        ? ''
        : context.tr('assistant.provider.$provider');
    return Text(
      context.tr('assistant.notice', args: {'provider': name}),
      style: AppTextStyles.caption.copyWith(color: context.textMuted),
    );
  }
}
