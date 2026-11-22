import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/network/idempotency_key.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../sales/ui/widgets/doc_status_chip.dart';
import '../data/models/order.dart';
import '../data/repo/orders_repository.dart';
import 'order_result_view.dart';

/// "Mes commandes": the seller's orders with their status.
class MyOrdersScreen extends StatefulWidget {
  const MyOrdersScreen({super.key});

  static const statuses = ['DRAFT', 'CONFIRMED', 'DELIVERED', 'CANCELLED'];

  @override
  State<MyOrdersScreen> createState() => _MyOrdersScreenState();
}

class _MyOrdersScreenState extends State<MyOrdersScreen> {
  final _repo = getIt<OrdersRepository>();
  String? _status;
  late final PagedCubit<OrderSummary> _cubit = PagedCubit<OrderSummary>(
    (cursor) => _repo.list(cursor: cursor),
  )..refresh();

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  void _filter(String? status) {
    setState(() => _status = status);
    _cubit.reset((cursor) => _repo.list(status: status, cursor: cursor));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('order.mine'))),
      body: Column(
        children: [
          SizedBox(
            height: AppSpacing.minTouch + AppSpacing.md,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.xs,
              ),
              children: [
                AppChoiceChip(
                  label: context.tr('order.all'),
                  selected: _status == null,
                  onTap: () => _filter(null),
                ),
                for (final s in MyOrdersScreen.statuses) ...[
                  AppSpacing.gapSm,
                  AppChoiceChip(
                    label: context.tr('status.$s'),
                    selected: _status == s,
                    onTap: () => _filter(s),
                  ),
                ],
              ],
            ),
          ),
          Expanded(
            child:
                BlocBuilder<PagedCubit<OrderSummary>, PagedState<OrderSummary>>(
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
                    if (state.isEmpty) {
                      return AppEmptyState(
                        icon: Icons.receipt_long_outlined,
                        title: context.tr('order.none'),
                      );
                    }
                    return RefreshIndicator(
                      onRefresh: _cubit.refresh,
                      child: NotificationListener<ScrollNotification>(
                        onNotification: (n) {
                          if (n.metrics.extentAfter < 400) _cubit.loadMore();
                          return false;
                        },
                        child: ListView.separated(
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          itemCount: state.items.length,
                          separatorBuilder: (_, _) => AppSpacing.gapSm,
                          itemBuilder: (context, i) {
                            final o = state.items[i];
                            return AppCard(
                              padding: const EdgeInsets.all(AppSpacing.md),
                              onTap: () async {
                                await Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        OrderDetailScreen(orderId: o.id),
                                  ),
                                );
                                await _cubit.refresh();
                              },
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          o.client.name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: text.titleSmall,
                                        ),
                                        Text(
                                          [
                                            o.number ??
                                                context.tr('order.no_number'),
                                            AlgiersDay.displayDateTime(
                                              o.createdAt,
                                            ),
                                          ].join(' · '),
                                          style: text.bodySmall?.copyWith(
                                            color: context.textMuted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  AppSpacing.gapSm,
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      AmountText(
                                        o.totalTtc,
                                        style: text.titleSmall,
                                      ),
                                      const SizedBox(height: AppSpacing.xxs),
                                      DocStatusChip(status: o.status),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                    );
                  },
                ),
          ),
        ],
      ),
    );
  }
}

/// One order; a draft can be cancelled with a reason (never deleted).
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  final _repo = getIt<OrdersRepository>();
  late final LoadCubit<Order> _cubit = LoadCubit<Order>(
    () => _repo.get(widget.orderId),
  )..load();

  /// Created when the cancel form opens; reused if the user retries.
  IdempotencyKey? _cancelKey;

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  Future<void> _cancel(Order o) async {
    final messenger = ScaffoldMessenger.of(context);
    _cancelKey ??= IdempotencyKey();
    final reason = await askText(
      context,
      title: context.tr('order.cancel_title'),
      label: context.tr('order.cancel_reason'),
      minLength: 3,
      confirmLabel: context.tr('order.cancel'),
    );
    if (reason == null || !mounted) return;
    final result = await _repo.cancel(o.id, reason, _cancelKey!);
    if (!mounted) return;
    switch (result) {
      case Success(:final data):
        _cancelKey = null;
        _cubit.set(data);
      case Failure(:final error):
        messenger.showSnackBar(
          SnackBar(content: Text(apiErrorText(context, error))),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<LoadCubit<Order>, LoadState<Order>>(
      bloc: _cubit,
      builder: (context, state) => state.data != null
          ? OrderResultView(
              order: state.data!,
              actions: [
                if (state.data!.isDraft || state.data!.status == 'CONFIRMED')
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.lg),
                    child: AppButton(
                      label: context.tr('order.cancel'),
                      icon: Icons.cancel_outlined,
                      variant: AppButtonVariant.text,
                      onPressed: () => _cancel(state.data!),
                    ),
                  ),
              ],
            )
          : Scaffold(
              appBar: AppBar(title: Text(context.tr('order.title'))),
              body: LoadStateView<Order>(
                state: state,
                onRetry: _cubit.load,
                builder: (_, _) => const SizedBox.shrink(),
              ),
            ),
    );
  }
}
