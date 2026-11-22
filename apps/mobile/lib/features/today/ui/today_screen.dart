import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/today.dart';
import '../data/repo/today_repository.dart';

/// "Aujourd'hui": the seller's truck and today's stops in route order, with
/// each client's balance and whether he was visited. Tapping a stop opens the
/// client ([onOpenClient]).
class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key, this.onOpenClient, this.onOpenClients});

  final void Function(BuildContext context, TodayStop stop)? onOpenClient;

  /// Without TOURNEES there is no tournée: the empty state points here.
  final VoidCallback? onOpenClients;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    final hasTournees = user?.hasFeature(Feature.tournees) ?? false;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('today.title'))),
      body: hasTournees
          ? BlocProvider(
              create: (_) =>
                  LoadCubit<Today>(getIt<TodayRepository>().today)..load(),
              child: _TodayBody(onOpenClient: onOpenClient),
            )
          : AppEmptyState(
              icon: Icons.route_outlined,
              title: context.tr('today.no_tournees_title'),
              message: context.tr('today.no_tournees_message'),
              actionLabel: context.tr('today.open_clients'),
              onAction: onOpenClients,
            ),
    );
  }
}

class _TodayBody extends StatelessWidget {
  const _TodayBody({this.onOpenClient});

  final void Function(BuildContext context, TodayStop stop)? onOpenClient;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<LoadCubit<Today>>();
    return BlocBuilder<LoadCubit<Today>, LoadState<Today>>(
      builder: (context, state) => LoadStateView<Today>(
        state: state,
        onRetry: cubit.load,
        skeleton: const ListSkeleton(),
        builder: (context, today) => RefreshIndicator(
          onRefresh: cubit.load,
          child: ListView(
            padding: const EdgeInsetsDirectional.fromSTEB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.navClearance,
            ),
            children: [
              TodayHeader(today: today),
              AppSpacing.gapLg,
              if (today.stops.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xl),
                  child: AppEmptyState(
                    icon: Icons.event_available_outlined,
                    title: context.tr('today.no_stops_title'),
                    message: context.tr('today.no_stops_message'),
                  ),
                )
              else
                for (var i = 0; i < today.stops.length; i++) ...[
                  StopTile(
                    index: i + 1,
                    stop: today.stops[i],
                    onTap: onOpenClient == null
                        ? null
                        : () => onOpenClient!(context, today.stops[i]),
                  ),
                  AppSpacing.gapSm,
                ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Truck chip and the visited / planned progress.
class TodayHeader extends StatelessWidget {
  const TodayHeader({super.key, required this.today});

  final Today today;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final vehicle = today.vehicle;
    final progress = today.planned == 0 ? 0.0 : today.visited / today.planned;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.local_shipping_outlined,
                color: vehicle == null ? context.textFaint : scheme.primary,
              ),
              AppSpacing.gapSm,
              Expanded(
                child: Text(
                  vehicle?.label ?? context.tr('today.no_truck'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleMedium,
                ),
              ),
            ],
          ),
          AppSpacing.gapMd,
          Row(
            children: [
              Expanded(
                child: Text(
                  context.tr(
                    'today.progress',
                    args: {'visited': today.visited, 'planned': today.planned},
                  ),
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                ),
              ),
              if (today.routes.isNotEmpty)
                Flexible(
                  child: Text(
                    today.routes.map((r) => r.name).join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ),
            ],
          ),
          AppSpacing.gapSm,
          ClipRRect(
            borderRadius: AppRadius.pillAll,
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 6,
              backgroundColor: context.fieldBorder,
            ),
          ),
        ],
      ),
    );
  }
}

/// One stop: order number, client, commune, balance, visited mark.
class StopTile extends StatelessWidget {
  const StopTile({
    super.key,
    required this.index,
    required this.stop,
    this.onTap,
  });

  final int index;
  final TodayStop stop;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final client = stop.client;
    final subtitle = [
      client.code,
      if (client.commune != null && client.commune!.isNotEmpty) client.commune!,
    ].join(' · ');
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.md,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
        child: Row(
          children: [
            CircleAvatar(
              radius: 16,
              backgroundColor: stop.visitedToday
                  ? AppColors.success
                  : scheme.primary.withValues(alpha: 0.12),
              child: stop.visitedToday
                  ? Icon(
                      Icons.check_rounded,
                      size: 18,
                      color: AppColors.white,
                      semanticLabel: context.tr('today.visited'),
                    )
                  : Text(
                      '$index',
                      style: text.labelLarge?.copyWith(color: scheme.primary),
                    ),
            ),
            AppSpacing.gapMd,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    client.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ],
              ),
            ),
            AppSpacing.gapSm,
            AmountText(stop.balance, colorBySign: true, style: text.titleSmall),
          ],
        ),
      ),
    );
  }
}
