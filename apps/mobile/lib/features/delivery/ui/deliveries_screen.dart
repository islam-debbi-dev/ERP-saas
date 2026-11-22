import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/router/tab_badges.dart';
import '../../../core/session/session_cubit.dart';
import '../../orders/data/models/order.dart';
import '../data/deliveries_repository.dart';
import '../logic/delivery_groups.dart';

/// "Livraisons": the confirmed orders put on the livreur or on the truck he
/// drives, grouped by client: today's stops first in route order, then the
/// other clients. The count goes on the tab's badge.
class DeliveriesScreen extends StatelessWidget {
  const DeliveriesScreen({super.key, required this.tabPath, this.onOpenOrder});

  /// The tab's path, the key of its badge.
  final String tabPath;

  /// Opens an order to deliver it; the list reloads when it comes back.
  final Future<Object?> Function(BuildContext context, OrderSummary order)?
  onOpenOrder;

  @override
  Widget build(BuildContext context) {
    final user = context.read<SessionCubit>().state.user;
    final withRoute = user?.hasFeature(Feature.tournees) ?? false;
    return BlocProvider(
      create: (_) => LoadCubit<DeliveriesBoard>(
        () => getIt<DeliveriesRepository>().board(withRoute: withRoute),
      )..load(),
      child:
          BlocListener<LoadCubit<DeliveriesBoard>, LoadState<DeliveriesBoard>>(
            listenWhen: (_, s) => s.data != null && !s.loading,
            listener: (_, s) => TabBadges.of(tabPath).value = s.data!.count,
            child: Scaffold(
              appBar: AppBar(title: Text(context.tr('delivery.title'))),
              body: _Body(onOpenOrder: onOpenOrder),
            ),
          ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({this.onOpenOrder});

  final Future<Object?> Function(BuildContext context, OrderSummary order)?
  onOpenOrder;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<LoadCubit<DeliveriesBoard>>();
    return BlocBuilder<LoadCubit<DeliveriesBoard>, LoadState<DeliveriesBoard>>(
      builder: (context, state) => LoadStateView<DeliveriesBoard>(
        state: state,
        onRetry: cubit.load,
        skeleton: const ListSkeleton(),
        builder: (context, board) => RefreshIndicator(
          onRefresh: cubit.load,
          child: board.isEmpty
              ? ListView(
                  padding: const EdgeInsets.only(top: AppSpacing.xxl),
                  children: [
                    AppEmptyState(
                      icon: Icons.inventory_2_outlined,
                      title: context.tr('delivery.empty_title'),
                      message: context.tr('delivery.empty_message'),
                    ),
                  ],
                )
              : ListView(
                  padding: const EdgeInsetsDirectional.fromSTEB(
                    AppSpacing.lg,
                    AppSpacing.md,
                    AppSpacing.lg,
                    AppSpacing.navClearance,
                  ),
                  children: [
                    for (final g in board.groups) ...[
                      DeliveryGroupHeader(group: g),
                      for (final o in g.orders) ...[
                        DeliveryTile(
                          order: o,
                          onTap: onOpenOrder == null
                              ? null
                              : () async {
                                  await onOpenOrder!(context, o);
                                  await cubit.load();
                                },
                        ),
                        AppSpacing.gapSm,
                      ],
                      AppSpacing.gapSm,
                    ],
                  ],
                ),
        ),
      ),
    );
  }
}

/// The client of a group, with his stop number in today's tournée.
class DeliveryGroupHeader extends StatelessWidget {
  const DeliveryGroupHeader({super.key, required this.group});

  final DeliveryGroup group;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: group.onRoute
                ? scheme.primary.withValues(alpha: 0.12)
                : context.fieldBorder,
            child: group.onRoute
                ? Text(
                    '${group.stop}',
                    style: text.labelMedium?.copyWith(color: scheme.primary),
                  )
                : Icon(
                    Icons.storefront_outlined,
                    size: 16,
                    color: context.textMuted,
                  ),
          ),
          AppSpacing.gapSm,
          Expanded(
            child: Text(
              group.clientName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: text.titleSmall,
            ),
          ),
          AppSpacing.gapSm,
          Text(
            group.onRoute
                ? context.tr('delivery.stop', args: {'n': group.stop!})
                : context.tr('delivery.off_route'),
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
        ],
      ),
    );
  }
}

/// One order to deliver: number, requested date, lines, TTC, short stock.
class DeliveryTile extends StatelessWidget {
  const DeliveryTile({super.key, required this.order, this.onTap});

  final OrderSummary order;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final date = order.requestedDate;
    final subtitle = [
      context.tr('delivery.line_count', args: {'count': order.lineCount}),
      date == null
          ? context.tr('order.no_date')
          : context.tr(
              'order.for_date',
              args: {'date': AlgiersDay.display(date)},
            ),
    ].join(' · ');
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.number ?? context.tr('order.no_number'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: TextDirection.ltr,
                    style: text.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                  if (order.shortLines > 0) ...[
                    const SizedBox(height: AppSpacing.xxs),
                    Row(
                      children: [
                        Icon(
                          Icons.warning_amber_rounded,
                          size: 16,
                          color: scheme.error,
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                        Flexible(
                          child: Text(
                            context.tr(
                              'delivery.short_lines',
                              args: {'count': order.shortLines},
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodySmall?.copyWith(
                              color: scheme.error,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            AppSpacing.gapSm,
            AmountText(order.totalTtc, style: text.titleSmall),
            if (onTap != null)
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
  }
}
