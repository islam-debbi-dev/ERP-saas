import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/helpers/text_direction.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/paged_cubit.dart';
import '../data/assistant_models.dart';
import '../data/assistant_repository.dart';

/// What the history hands back to the chat: the conversation to open, and
/// the ones deleted (the chat resets if it showed one of them).
class HistoryResult {
  const HistoryResult({this.open, this.deleted = const {}});
  final String? open;
  final Set<String> deleted;
}

/// The user's conversations (`GET /assistant/conversations`, newest first,
/// 30 a page): tap opens one, the bin deletes it after a confirm.
class AssistantHistoryScreen extends StatefulWidget {
  const AssistantHistoryScreen({super.key});

  @override
  State<AssistantHistoryScreen> createState() => _AssistantHistoryScreenState();
}

class _AssistantHistoryScreenState extends State<AssistantHistoryScreen> {
  final _repo = getIt<AssistantRepository>();
  late final PagedCubit<AssistantConversation> _cubit;
  final _deleted = <String>{};
  String? _deleting;

  @override
  void initState() {
    super.initState();
    _cubit = PagedCubit<AssistantConversation>(
      (cursor) => _repo.conversations(cursor: cursor),
    )..refresh();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  void _close([String? open]) => Navigator.of(
    context,
  ).pop(HistoryResult(open: open, deleted: Set.of(_deleted)));

  Future<void> _delete(AssistantConversation c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(dialog.tr('assistant.delete_confirm_title')),
        content: Text(
          '${c.title}\n\n${dialog.tr('assistant.delete_confirm_message')}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(dialog.tr('common.cancel')),
          ),
          TextButton(
            key: const Key('assistant-delete-confirm'),
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(dialog.tr('assistant.delete')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _deleting = c.id);
    final result = await _repo.deleteConversation(c.id);
    if (!mounted) return;
    setState(() => _deleting = null);
    switch (result) {
      case Success():
        _deleted.add(c.id);
        _cubit.removeWhere((x) => x.id == c.id);
      case Failure(:final error):
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorText(context, error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('assistant.history'))),
        body:
            BlocBuilder<
              PagedCubit<AssistantConversation>,
              PagedState<AssistantConversation>
            >(
              bloc: _cubit,
              builder: (context, state) {
                if (state.isFirstLoad) return const ListSkeleton();
                if (state.status == PagedStatus.failure &&
                    state.items.isEmpty) {
                  return AppErrorState(
                    title: context.tr('common.load_failed'),
                    message: state.error == null
                        ? null
                        : apiErrorText(context, state.error!),
                    retryLabel: context.tr('common.retry'),
                    onRetry: _cubit.refresh,
                  );
                }
                if (state.items.isEmpty) {
                  return AppEmptyState(
                    icon: Icons.history,
                    title: context.tr('assistant.history_empty'),
                  );
                }
                return RefreshIndicator(
                  onRefresh: _cubit.refresh,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: state.items.length + (state.hasMore ? 1 : 0),
                    separatorBuilder: (_, _) => AppSpacing.gapSm,
                    itemBuilder: (context, i) {
                      if (i == state.items.length) {
                        return OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(
                              AppSpacing.minTouch,
                            ),
                          ),
                          onPressed: state.loadingMore ? null : _cubit.loadMore,
                          child: Text(context.tr('assistant.load_more')),
                        );
                      }
                      final c = state.items[i];
                      return _ConversationRow(
                        conversation: c,
                        deleting: _deleting == c.id,
                        onOpen: () => _close(c.id),
                        onDelete: () => _delete(c),
                      );
                    },
                  ),
                );
              },
            ),
      ),
    );
  }
}

class _ConversationRow extends StatelessWidget {
  const _ConversationRow({
    required this.conversation,
    required this.deleting,
    required this.onOpen,
    required this.onDelete,
  });

  final AssistantConversation conversation;
  final bool deleting;
  final VoidCallback onOpen;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final c = conversation;
    return AppCard(
      padding: const EdgeInsetsDirectional.only(start: AppSpacing.md),
      onTap: onOpen,
      child: Row(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    c.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textDirection: textDirectionOf(
                      c.title,
                      fallback: Directionality.of(context),
                    ),
                    style: AppTextStyles.bodyLarge.copyWith(
                      color: context.textMain,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    // Isolated LTR: "22/11/2026 14:05" keeps its order in
                    // Arabic.
                    '${Money.ltrIsolateStart}'
                    '${AlgiersDay.displayDateTime(c.createdAt)}'
                    '${Money.ltrIsolateEnd}',
                    style: AppTextStyles.caption.copyWith(
                      color: context.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            tooltip: context.tr(
              'assistant.delete_conversation',
              args: {'title': c.title},
            ),
            constraints: const BoxConstraints(
              minWidth: AppSpacing.minTouch,
              minHeight: AppSpacing.minTouch,
            ),
            onPressed: deleting ? null : onDelete,
            icon: const Icon(Icons.delete_outline),
          ),
        ],
      ),
    );
  }
}
