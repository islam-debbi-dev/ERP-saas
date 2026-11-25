import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../data/controls_repository.dart';
import 'control_maps.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

enum ControlsSection { positions, flags, report }

/// "Contrôles": the team's location requests (approve / reject), its GPS
/// flags (read only: the verdict stays with managers) and today's tournée
/// report. Each section shows only with its module.
class ControlsScreen extends StatefulWidget {
  const ControlsScreen({super.key, this.clock, this.onOpenMap});

  /// Tests pin "today".
  final DateTime Function()? clock;

  /// The team's client map (a sub-page); shown with GEO_CHECK only.
  final VoidCallback? onOpenMap;

  @override
  State<ControlsScreen> createState() => _ControlsScreenState();
}

class _ControlsScreenState extends State<ControlsScreen> {
  ControlsSection? _section;

  bool _hasGeo(BuildContext context) =>
      context.read<SessionCubit>().state.user?.hasFeature(Feature.geoCheck) ??
      false;

  List<ControlsSection> _sections(BuildContext context) {
    final user = context.read<SessionCubit>().state.user;
    final geo = user?.hasFeature(Feature.geoCheck) ?? false;
    final tournees = user?.hasFeature(Feature.tournees) ?? false;
    return [
      if (geo) ControlsSection.positions,
      if (geo) ControlsSection.flags,
      if (tournees) ControlsSection.report,
    ];
  }

  @override
  Widget build(BuildContext context) {
    final sections = _sections(context);
    final now = (widget.clock ?? DateTime.now)();
    final section = sections.contains(_section)
        ? _section!
        : (sections.isEmpty ? null : sections.first);
    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('controls.title')),
        actions: [
          if (_hasGeo(context) && widget.onOpenMap != null)
            IconButton(
              icon: const Icon(Icons.map_outlined),
              tooltip: context.tr('map.team_map'),
              onPressed: widget.onOpenMap,
            ),
        ],
      ),
      body: section == null
          ? ListView(
              padding: const EdgeInsets.only(top: AppSpacing.xxl),
              children: [
                AppEmptyState(
                  icon: Icons.verified_user_outlined,
                  title: context.tr('controls.none_title'),
                  message: context.tr('controls.none_message'),
                ),
              ],
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.sm,
                    AppSpacing.lg,
                    AppSpacing.xs,
                  ),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.xs,
                      children: [
                        for (final s in sections)
                          AppChoiceChip(
                            label: context.tr('controls.section_${s.name}'),
                            selected: s == section,
                            onTap: () => setState(() => _section = s),
                          ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: switch (section) {
                    ControlsSection.positions => const _PositionsSection(),
                    ControlsSection.flags => _FlagsSection(now: now),
                    ControlsSection.report => _ReportSection(now: now),
                  },
                ),
              ],
            ),
    );
  }
}

// ------------------------------------------------------------------ positions

class _PositionsSection extends StatelessWidget {
  const _PositionsSection();

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LoadCubit<List<LocationRequest>>(
        () => getIt<ControlsRepository>().pendingRequests(),
      )..load(),
      child:
          BlocBuilder<
            LoadCubit<List<LocationRequest>>,
            LoadState<List<LocationRequest>>
          >(
            builder: (context, state) {
              final cubit = context.read<LoadCubit<List<LocationRequest>>>();
              return LoadStateView<List<LocationRequest>>(
                state: state,
                onRetry: cubit.load,
                skeleton: const ListSkeleton(),
                builder: (context, requests) => RefreshIndicator(
                  onRefresh: cubit.load,
                  child: requests.isEmpty
                      ? ListView(
                          padding: const EdgeInsets.only(top: AppSpacing.xxl),
                          children: [
                            AppEmptyState(
                              icon: Icons.wrong_location_outlined,
                              title: context.tr('controls.positions_empty'),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: EdgeInsets.fromLTRB(
                            AppSpacing.lg,
                            AppSpacing.sm,
                            AppSpacing.lg,
                            CustomBottomNavigation.listEnd(context),
                          ),
                          itemCount: requests.length,
                          separatorBuilder: (_, _) => AppSpacing.gapSm,
                          itemBuilder: (context, i) => LocationRequestCard(
                            request: requests[i],
                            onDecided: cubit.load,
                          ),
                        ),
                ),
              );
            },
          ),
    );
  }
}

/// One pending request: who asked, how far the pin moves, and the
/// decision buttons when the API says this supervisor may decide.
class LocationRequestCard extends StatefulWidget {
  const LocationRequestCard({
    super.key,
    required this.request,
    required this.onDecided,
  });

  final LocationRequest request;
  final Future<void> Function() onDecided;

  @override
  State<LocationRequestCard> createState() => _LocationRequestCardState();
}

class _LocationRequestCardState extends State<LocationRequestCard> {
  bool _busy = false;

  Future<void> _decide(
    Future<ApiResult<LocationRequest>> Function() send,
    String doneKey,
  ) async {
    setState(() => _busy = true);
    final r = await send();
    if (!mounted) return;
    setState(() => _busy = false);
    final messenger = ScaffoldMessenger.of(context);
    switch (r) {
      case Success():
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              context.tr(doneKey, args: {'client': widget.request.client.name}),
            ),
          ),
        );
        await widget.onDecided();
      case Failure(:final error):
        messenger.showSnackBar(
          SnackBar(content: Text(apiErrorText(context, error))),
        );
        // GEO_REQUEST_NOT_PENDING: someone else decided; refresh the list.
        await widget.onDecided();
    }
  }

  Future<void> _approve() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('controls.approve_title')),
        content: Text(
          context.tr(
            'controls.approve_body',
            args: {'client': widget.request.client.name},
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.tr('controls.approve')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await _decide(
      () => getIt<ControlsRepository>().approve(widget.request.id),
      'controls.approved',
    );
  }

  Future<void> _reject() async {
    final reason = await askText(
      context,
      title: context.tr('controls.reject_title'),
      label: context.tr('controls.reject_reason'),
      minLength: 3,
      confirmLabel: context.tr('controls.reject'),
    );
    if (reason == null || reason.trim().length < 3 || !mounted) return;
    await _decide(
      () => getIt<ControlsRepository>().reject(widget.request.id, reason),
      'controls.rejected',
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    final text = Theme.of(context).textTheme;
    final moved = r.movedM;
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            r.client.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: text.titleSmall,
          ),
          const SizedBox(height: AppSpacing.xxs),
          Text(
            context.tr(
              'controls.requested_by',
              args: {
                'name': r.requestedBy?.fullName ?? '—',
                'time': AlgiersDay.displayDateTime(r.requestedAt),
              },
            ),
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
          AppSpacing.gapXs,
          Row(
            children: [
              Icon(
                Icons.place_outlined,
                size: 18,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  moved == null
                      ? context.tr('controls.first_position')
                      : context.tr(
                          'controls.moved',
                          args: {'m': Money.ltr(_metres(moved))},
                        ),
                  style: text.bodyMedium,
                ),
              ),
            ],
          ),
          if (r.accuracyM != null)
            Text(
              context.tr(
                'controls.accuracy',
                args: {'m': Money.ltr(_metres(r.accuracyM!))},
              ),
              style: text.bodySmall?.copyWith(color: context.textMuted),
            ),
          AppSpacing.gapSm,
          LocationRequestMap(request: r),
          if (r.note != null && r.note!.isNotEmpty) ...[
            AppSpacing.gapXs,
            Text(r.note!, style: text.bodyMedium),
          ],
          if (r.canDecide) ...[
            AppSpacing.gapMd,
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: context.tr('controls.reject'),
                    variant: AppButtonVariant.outline,
                    onPressed: _busy ? null : _reject,
                  ),
                ),
                AppSpacing.gapSm,
                Expanded(
                  child: AppButton(
                    label: context.tr('controls.approve'),
                    loading: _busy,
                    onPressed: _busy ? null : _approve,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// `12 m`, `1,2 km`: a distance for display only.
String _metres(double m) {
  if (m < 1000) return '${m.round()} m';
  final km = (m / 100).round() / 10;
  return '${km.toString().replaceAll('.', ',')} km';
}

// ------------------------------------------------------------------ GPS flags

class _FlagsSection extends StatefulWidget {
  const _FlagsSection({required this.now});

  final DateTime now;

  /// How far back the list goes.
  static const days = 7;

  @override
  State<_FlagsSection> createState() => _FlagsSectionState();
}

class _FlagsSectionState extends State<_FlagsSection> {
  late final PagedCubit<GeoFlagItem> _cubit;

  @override
  void initState() {
    super.initState();
    final to = AlgiersDay.of(widget.now);
    final from = AlgiersDay.minusDays(_FlagsSection.days - 1, widget.now);
    final repo = getIt<ControlsRepository>();
    _cubit = PagedCubit<GeoFlagItem>(
      (cursor) => repo.geoFlags(from: from, to: to, cursor: cursor),
    )..refresh();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<PagedCubit<GeoFlagItem>, PagedState<GeoFlagItem>>(
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
        return RefreshIndicator(
          onRefresh: _cubit.refresh,
          child: NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n.metrics.extentAfter < 400) _cubit.loadMore();
              return false;
            },
            child: ListView(
              padding: EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.sm,
                AppSpacing.lg,
                CustomBottomNavigation.listEnd(context),
              ),
              children: [
                Text(
                  context.tr(
                    'controls.flags_hint',
                    args: {'days': _FlagsSection.days},
                  ),
                  style: AppTextStyles.caption.copyWith(
                    color: context.textMuted,
                  ),
                ),
                AppSpacing.gapSm,
                if (state.isEmpty)
                  AppEmptyState(
                    icon: Icons.gps_fixed,
                    title: context.tr('controls.flags_empty'),
                  ),
                for (final f in state.items) ...[
                  GeoFlagCard(flag: f),
                  AppSpacing.gapSm,
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

/// A flagged operation, read only. No verdict here: only managers give it.
class GeoFlagCard extends StatelessWidget {
  const GeoFlagCard({super.key, required this.flag});

  final GeoFlagItem flag;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final color = switch (flag.status) {
      'MOCKED' => AppColors.error,
      'FAR' => AppColors.warning,
      _ => AppColors.textTertiary,
    };
    final what = [
      context.tr('controls.ref_${flag.refType}'),
      if (flag.refNumber != null) Money.ltr(flag.refNumber!),
    ].join(' ');
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.gps_not_fixed, size: 18, color: color),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  context.tr('controls.status_${flag.status}'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall?.copyWith(color: color),
                ),
              ),
              Text(
                context.tr('controls.review_${flag.reviewStatus}'),
                style: AppTextStyles.caption.copyWith(color: context.textMuted),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xxs),
          Text(
            [
              flag.user?.fullName ?? '—',
              AlgiersDay.displayDateTime(flag.receivedAt),
            ].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
          Text(
            [what, if (flag.client != null) flag.client!.name].join(' · '),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: text.bodyMedium,
          ),
          if (flag.distanceM != null)
            Text(
              context.tr(
                'controls.distance',
                args: {'m': Money.ltr(_metres(flag.distanceM!))},
              ),
              style: text.bodySmall,
            ),
          if (flag.hasPoint || flag.hasClientPoint) ...[
            AppSpacing.gapSm,
            GeoFlagMap(flag: flag),
          ],
          if (flag.flags.contains('LATE_SYNC'))
            Text(
              context.tr('controls.late_sync'),
              style: text.bodySmall?.copyWith(color: context.textMuted),
            ),
          if (flag.note != null && flag.note!.isNotEmpty)
            Text(
              context.tr('controls.note', args: {'note': flag.note!}),
              style: text.bodySmall,
            ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ report

class _ReportSection extends StatelessWidget {
  const _ReportSection({required this.now});

  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final day = AlgiersDay.of(now);
    return BlocProvider(
      create: (_) => LoadCubit<List<TourneeReportRow>>(
        () => getIt<ControlsRepository>().report(day),
      )..load(),
      child:
          BlocBuilder<
            LoadCubit<List<TourneeReportRow>>,
            LoadState<List<TourneeReportRow>>
          >(
            builder: (context, state) {
              final cubit = context.read<LoadCubit<List<TourneeReportRow>>>();
              return LoadStateView<List<TourneeReportRow>>(
                state: state,
                onRetry: cubit.load,
                skeleton: const ListSkeleton(),
                builder: (context, rows) => RefreshIndicator(
                  onRefresh: cubit.load,
                  child: rows.isEmpty
                      ? ListView(
                          padding: const EdgeInsets.only(top: AppSpacing.xxl),
                          children: [
                            AppEmptyState(
                              icon: Icons.route_outlined,
                              title: context.tr('controls.report_empty'),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: EdgeInsets.fromLTRB(
                            AppSpacing.lg,
                            AppSpacing.sm,
                            AppSpacing.lg,
                            CustomBottomNavigation.listEnd(context),
                          ),
                          itemCount: rows.length,
                          separatorBuilder: (_, _) => AppSpacing.gapSm,
                          itemBuilder: (context, i) =>
                              TourneeReportCard(row: rows[i]),
                        ),
                ),
              );
            },
          ),
    );
  }
}

/// One member's day: stops visited, strike rate, orders, deliveries, écart.
class TourneeReportCard extends StatelessWidget {
  const TourneeReportCard({super.key, required this.row});

  final TourneeReportRow row;

  static String _pct(double? v) => v == null ? '—' : '${(v * 100).round()} %';

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    Widget line(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        children: [
          Expanded(child: Text(label, style: text.bodySmall)),
          AppSpacing.gapSm,
          Text(Money.ltr(value), style: text.bodyMedium),
        ],
      ),
    );
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            row.seller.fullName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.titleSmall,
          ),
          AppSpacing.gapXs,
          line(
            context.tr('controls.r_stops'),
            '${row.visitedStops} / ${row.plannedStops} · ${_pct(row.visitRate)}',
          ),
          line(
            context.tr('controls.r_visits'),
            '${row.productiveVisits} / ${row.visits} · ${_pct(row.strikeRate)}',
          ),
          line(context.tr('controls.r_orders'), '${row.orders}'),
          line(context.tr('controls.r_delivered'), '${row.delivered}'),
          if (row.shortLines > 0)
            line(context.tr('controls.r_short'), '${row.shortLines}'),
          if (row.closings > 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      context.tr('controls.r_ecart'),
                      style: text.bodySmall,
                    ),
                  ),
                  AppSpacing.gapSm,
                  AmountText(
                    row.ecart,
                    colorBySign: true,
                    style: text.bodyMedium,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
