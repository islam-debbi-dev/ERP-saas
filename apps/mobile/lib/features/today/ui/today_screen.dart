import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/map/map_list_toggle.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/today.dart';
import '../data/repo/today_repository.dart';
import 'today_map.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

/// "Aujourd'hui": the seller's truck and today's stops in route order, with
/// each client's balance and whether he was visited. Tapping a stop opens the
/// client ([onOpenClient]). With GEO_CHECK a Liste / Carte toggle shows the
/// same day on a map.
class TodayScreen extends StatelessWidget {
  const TodayScreen({
    super.key,
    this.onOpenClient,
    this.onOpenClients,
    this.onOpenClientId,
  });

  /// Opens the client of a stop; the day reloads when it comes back.
  final Future<Object?> Function(BuildContext context, TodayStop stop)?
  onOpenClient;

  /// Opens a client of the map's "Clients" layer (not a stop of today).
  final Future<Object?> Function(BuildContext context, String clientId)?
  onOpenClientId;

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
              child: _TodayBody(
                onOpenClient: onOpenClient,
                onOpenClientId: onOpenClientId,
                withMap: user?.hasFeature(Feature.geoCheck) ?? false,
              ),
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

class _TodayBody extends StatefulWidget {
  const _TodayBody({
    this.onOpenClient,
    this.onOpenClientId,
    this.withMap = false,
  });

  final Future<Object?> Function(BuildContext context, TodayStop stop)?
  onOpenClient;
  final Future<Object?> Function(BuildContext context, String clientId)?
  onOpenClientId;

  /// GEO_CHECK: the Liste / Carte toggle shows.
  final bool withMap;

  @override
  State<_TodayBody> createState() => _TodayBodyState();
}

class _TodayBodyState extends State<_TodayBody> {
  ListOrMap _view = ListOrMap.list;

  /// The map is built the first time it is shown, then kept (as the list).
  bool _mapBuilt = false;

  Future<void> _openStop(TodayStop stop) async {
    final open = widget.onOpenClient;
    if (open == null) return;
    final cubit = context.read<LoadCubit<Today>>();
    await open(context, stop);
    await cubit.load();
  }

  Future<void> _openClient(String id) async {
    final open = widget.onOpenClientId;
    if (open == null) return;
    final cubit = context.read<LoadCubit<Today>>();
    await open(context, id);
    await cubit.load();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<LoadCubit<Today>>();
    final content = BlocBuilder<LoadCubit<Today>, LoadState<Today>>(
      builder: (context, state) => LoadStateView<Today>(
        state: state,
        onRetry: cubit.load,
        skeleton: const ListSkeleton(),
        builder: (context, today) => IndexedStack(
          index: _view == ListOrMap.list ? 0 : 1,
          sizing: StackFit.expand,
          children: [
            _TodayList(
              today: today,
              onRefresh: cubit.load,
              onOpenStop: widget.onOpenClient == null ? null : _openStop,
            ),
            if (_mapBuilt)
              TodayMap(
                today: today,
                onRefresh: cubit.load,
                onOpenStop: widget.onOpenClient == null ? null : _openStop,
                onOpenClient: widget.onOpenClientId == null
                    ? null
                    : _openClient,
              )
            else
              const SizedBox.shrink(),
          ],
        ),
      ),
    );
    if (!widget.withMap) return content;
    return Column(
      children: [
        MapListToggle(
          value: _view,
          onChanged: (v) => setState(() {
            _view = v;
            if (v == ListOrMap.map) _mapBuilt = true;
          }),
        ),
        Expanded(child: content),
      ],
    );
  }
}

class _TodayList extends StatelessWidget {
  const _TodayList({
    required this.today,
    required this.onRefresh,
    this.onOpenStop,
  });

  final Today today;
  final Future<void> Function() onRefresh;
  final Future<void> Function(TodayStop stop)? onOpenStop;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: onRefresh,
    child: ListView(
      padding: EdgeInsetsDirectional.fromSTEB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        CustomBottomNavigation.listEnd(context),
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
              onTap: onOpenStop == null
                  ? null
                  : () => onOpenStop!(today.stops[i]),
            ),
            AppSpacing.gapSm,
          ],
      ],
    ),
  );
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
