import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../orders/data/models/order.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../sales/ui/my_sales_screen.dart' show SaleDetailScreen;

/// "Mes livraisons": the orders the livreur delivered (`GET /orders?status=
/// DELIVERED`, the API keeps him to his own), newest first; a row opens its
/// BL with "Partager PDF".
class MyDeliveriesScreen extends StatefulWidget {
  const MyDeliveriesScreen({super.key});

  @override
  State<MyDeliveriesScreen> createState() => _MyDeliveriesScreenState();
}

class _MyDeliveriesScreenState extends State<MyDeliveriesScreen> {
  late final PagedCubit<OrderSummary> _cubit = PagedCubit<OrderSummary>(
    (cursor) =>
        getIt<OrdersRepository>().list(status: 'DELIVERED', cursor: cursor),
  )..refresh();

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('delivery.history'))),
      body: BlocBuilder<PagedCubit<OrderSummary>, PagedState<OrderSummary>>(
        bloc: _cubit,
        builder: (context, state) {
          if (state.isFirstLoad) return const ListSkeleton();
          if (state.status == PagedStatus.failure && state.items.isEmpty) {
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
              icon: Icons.inventory_2_outlined,
              title: context.tr('delivery.history_empty'),
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
                  final bl = o.sale;
                  return AppCard(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    onTap: bl == null
                        ? null
                        : () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => SaleDetailScreen(saleId: bl.id),
                            ),
                          ),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(
                        minHeight: AppSpacing.minTouch,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  o.client.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: text.titleSmall,
                                ),
                                Text(
                                  bl?.number ??
                                      o.number ??
                                      context.tr('order.no_number'),
                                  textDirection: TextDirection.ltr,
                                  style: text.bodySmall?.copyWith(
                                    color: context.textMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // The order's TTC is what was ordered, not what
                          // the BL says after a partial delivery: the BL
                          // screen shows the real total.
                          if (bl != null)
                            Icon(
                              Directionality.of(context) == TextDirection.rtl
                                  ? Icons.chevron_left_rounded
                                  : Icons.chevron_right_rounded,
                              color: context.textFaint,
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          );
        },
      ),
    );
  }
}
