import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../../core/router/routes.dart';
import '../../catalog/ui/widgets/paged_product_slivers.dart';
import '../data/models/order.dart';
import '../data/repo/orders_repository.dart';
import 'widgets/order_status_chip.dart';

/// `GET /orders/mine` with a status filter.
class MyOrdersScreen extends StatefulWidget {
  const MyOrdersScreen({super.key});

  @override
  State<MyOrdersScreen> createState() => _MyOrdersScreenState();
}

class _MyOrdersScreenState extends State<MyOrdersScreen> {
  final _repo = getIt<OrderRepository>();
  late final PagedCubit<Order> _cubit = PagedCubit<Order>(_fetch)..refresh();
  OrderStatus? _status;

  PageFetcher<Order> get _fetch {
    final status = _status;
    return (page) => _repo.getMyOrders(page: page, status: status);
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  void _filter(OrderStatus? status) {
    setState(() => _status = status);
    _cubit.reset(_fetch);
  }

  Future<void> _open(Order order) async {
    final updated = await context.push<Order>(Routes.order(order.id));
    // Reflect a cancel made on the detail screen without a refetch.
    if (updated != null) {
      _cubit.replaceWhere((o) => o.id == updated.id, updated);
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('jb.orders.title'))),
        body: Column(
          children: [
            SizedBox(
              height: 52,
              child: ListView(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.screenH,
                  vertical: AppSpacing.xs,
                ),
                scrollDirection: Axis.horizontal,
                children: [
                  AppChoiceChip(
                    label: context.tr('jb.common.all'),
                    selected: _status == null,
                    onTap: () => _filter(null),
                  ),
                  for (final s in OrderStatus.values) ...[
                    const SizedBox(width: AppSpacing.sm),
                    AppChoiceChip(
                      label: orderStatusLabel(context, s),
                      selected: _status == s,
                      onTap: () => _filter(s),
                    ),
                  ],
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _cubit.refresh,
                child: LoadMoreListener(
                  onLoadMore: _cubit.loadMore,
                  child: BlocBuilder<PagedCubit<Order>, PagedState<Order>>(
                    builder: (context, state) => CustomScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      slivers: [_list(context, state)],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _list(BuildContext context, PagedState<Order> state) {
    if (state.isFirstLoad) return const AppSliverLoader();
    if (state.items.isEmpty && state.status == PagedStatus.failure) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: AppErrorState(
          title: context.tr('jb.common.load_failed'),
          retryLabel: context.tr('retry'),
          onRetry: _cubit.refresh,
        ),
      );
    }
    if (state.isEmpty) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: AppEmptyState(
          icon: Icons.receipt_long_outlined,
          title: context.tr('jb.orders.empty_title'),
          message: context.tr('jb.orders.empty_message'),
          actionLabel: context.tr('jb.orders.start_shopping'),
          onAction: () => context.go(Routes.home),
        ),
      );
    }
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.sm,
        AppSpacing.screenH,
        AppSpacing.xl,
      ),
      sliver: SliverList.separated(
        itemCount: state.items.length + 1,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.md),
        itemBuilder: (context, i) => i == state.items.length
            ? PagingFooter(state: state, onLoadMore: _cubit.loadMore)
            : _OrderTile(
                order: state.items[i],
                onTap: () => _open(state.items[i]),
              ),
      ),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.onTap});

  final Order order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('#${order.orderNumber}', style: text.titleSmall),
              ),
              OrderStatusChip(status: order.status),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(formatDateTime(context, order.createdAt), style: text.bodySmall),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: Text(
                  context.tr(
                    'jb.orders.items_count',
                    args: {
                      'count': formatQty(context, order.itemCount, 'piece'),
                    },
                  ),
                  style: text.bodySmall,
                ),
              ),
              Text(
                order.deliveryFee == null
                    ? context.tr(
                        'jb.orders.total_plus_delivery',
                        args: {'amount': formatDzd(context, order.total)},
                      )
                    : formatDzd(context, order.total),
                style: AppTextStyles.label.copyWith(color: context.textMain),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
