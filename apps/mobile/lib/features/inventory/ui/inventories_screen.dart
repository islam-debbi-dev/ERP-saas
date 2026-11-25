import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/load_cubit.dart';
import '../../stock_transfers/data/stock_transfers_repository.dart';
import '../../stock_transfers/data/transfer_models.dart';
import '../data/inventories_repository.dart';
import '../logic/inventory_count_cubit.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

/// The counts of the dépôts in reach, with their dépôt names.
class InventoriesPage {
  const InventoriesPage({required this.counts, required this.depots});

  final List<InventorySummary> counts;
  final List<DepotOption> depots;

  String depotName(String? id) {
    for (final d in depots) {
      if (d.id == id) return d.label;
    }
    return depots.where((d) => d.isDefault).firstOrNull?.label ?? '—';
  }
}

/// "Inventaire": the counts (open first), and *Nouveau comptage* on a dépôt
/// (STOCK_COUNT). Opens a count at `[basePath]/<id>`.
class InventoriesScreen extends StatelessWidget {
  const InventoriesScreen({super.key, required this.basePath});

  final String basePath;

  @override
  Widget build(BuildContext context) {
    final repo = getIt<InventoriesRepository>();
    final stock = getIt<StockTransfersRepository>();
    return BlocProvider(
      create: (_) => LoadCubit<InventoriesPage>(() async {
        final counts = await repo.list();
        if (counts case Failure(:final error)) return ApiResult.failure(error);
        final depots = await stock.depots();
        if (depots case Failure(:final error)) return ApiResult.failure(error);
        final list = [...(counts as Success<List<InventorySummary>>).data]
          ..sort((a, b) => a.isOpen == b.isOpen ? 0 : (a.isOpen ? -1 : 1));
        return ApiResult.success(
          InventoriesPage(
            counts: list,
            depots: (depots as Success<List<DepotOption>>).data,
          ),
        );
      })..load(),
      child:
          BlocBuilder<LoadCubit<InventoriesPage>, LoadState<InventoriesPage>>(
            builder: (context, state) {
              final cubit = context.read<LoadCubit<InventoriesPage>>();
              final page = state.data;
              return Scaffold(
                appBar: AppBar(title: Text(context.tr('inventory.title'))),
                floatingActionButton: page == null
                    ? null
                    : Padding(
                        padding: const EdgeInsets.only(bottom: CustomBottomNavigation.clearance),
                        child: FloatingActionButton.extended(
                          heroTag: 'new-count',
                          onPressed: () async {
                            final created =
                                await showModalBottomSheet<Inventory>(
                                  context: context,
                                  showDragHandle: true,
                                  isScrollControlled: true,
                                  builder: (_) =>
                                      NewCountSheet(depots: page.depots),
                                );
                            if (created == null || !context.mounted) return;
                            await context.push('$basePath/${created.id}');
                            await cubit.load();
                          },
                          icon: const Icon(Icons.add),
                          label: Text(context.tr('inventory.new')),
                        ),
                      ),
                body: LoadStateView<InventoriesPage>(
                  state: state,
                  onRetry: cubit.load,
                  skeleton: const ListSkeleton(),
                  builder: (context, page) => RefreshIndicator(
                    onRefresh: cubit.load,
                    child: page.counts.isEmpty
                        ? ListView(
                            children: [
                              AppEmptyState(
                                icon: Icons.fact_check_outlined,
                                title: context.tr('inventory.empty'),
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsetsDirectional.fromSTEB(
                              AppSpacing.lg,
                              AppSpacing.md,
                              AppSpacing.lg,
                              AppSpacing.navClearance + 56,
                            ),
                            itemCount: page.counts.length,
                            separatorBuilder: (_, _) => AppSpacing.gapSm,
                            itemBuilder: (context, i) {
                              final c = page.counts[i];
                              return InventoryTile(
                                count: c,
                                depot: page.depotName(c.warehouseId),
                                onTap: () async {
                                  await context.push('$basePath/${c.id}');
                                  await cubit.load();
                                },
                              );
                            },
                          ),
                  ),
                ),
              );
            },
          ),
    );
  }
}

class InventoryStatusChip extends StatelessWidget {
  const InventoryStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (key, color) = switch (status) {
      InventoryStatus.open => ('inventory.status_open', AppColors.warning),
      InventoryStatus.cancelled => (
        'inventory.status_cancelled',
        AppColors.error,
      ),
      _ => ('inventory.status_validated', AppColors.success),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: AppRadius.pillAll,
      ),
      child: Text(
        context.tr(key),
        maxLines: 1,
        style: AppTextStyles.caption.copyWith(
          color: context.isDarkMode
              ? color
              : Color.lerp(color, AppColors.ink, 0.4),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class InventoryTile extends StatelessWidget {
  const InventoryTile({
    super.key,
    required this.count,
    required this.depot,
    this.onTap,
  });

  final InventorySummary count;
  final String depot;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final c = count;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Icon(
            Icons.fact_check_outlined,
            color: Theme.of(context).colorScheme.primary,
          ),
          AppSpacing.gapMd,
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        c.number,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        style: text.titleSmall,
                      ),
                    ),
                    AppSpacing.gapSm,
                    InventoryStatusChip(status: c.status),
                  ],
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  [
                    depot,
                    AlgiersDay.displayDateTime(c.validatedAt ?? c.createdAt),
                    context.tr('truck.line_count', args: {'n': c.lineCount}),
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(color: context.textMuted),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right_rounded, color: context.textMuted),
        ],
      ),
    );
  }
}

/// Chooses the dépôt (preselected when he works in one) and opens the
/// count. Pops with the new inventory.
class NewCountSheet extends StatefulWidget {
  const NewCountSheet({super.key, required this.depots});

  final List<DepotOption> depots;

  @override
  State<NewCountSheet> createState() => _NewCountSheetState();
}

class _NewCountSheetState extends State<NewCountSheet> {
  late final _action = NewCountAction(getIt<InventoriesRepository>());
  late String? _depot = widget.depots.firstOrNull?.id;
  bool _busy = false;
  ApiError? _error;

  Future<void> _start() async {
    final depot = _depot;
    if (depot == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final r = await _action.start(depot);
    if (!mounted) return;
    switch (r) {
      case Success(:final data):
        Navigator.of(context).pop(data);
      case Failure(:final error):
        setState(() {
          _busy = false;
          _error = error;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          0,
          AppSpacing.lg,
          AppSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(context.tr('inventory.new'), style: text.titleMedium),
            AppSpacing.gapXs,
            Text(
              context.tr('inventory.new_hint'),
              style: text.bodySmall?.copyWith(color: context.textMuted),
            ),
            AppSpacing.gapMd,
            if (widget.depots.isEmpty)
              Text(context.tr('transfer.no_depots'), style: text.bodyMedium),
            for (final d in widget.depots)
              ListTile(
                minTileHeight: AppSpacing.minTouch,
                contentPadding: EdgeInsets.zero,
                selected: d.id == _depot,
                leading: Icon(
                  d.id == _depot
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                ),
                title: Text(
                  d.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: _busy ? null : () => setState(() => _depot = d.id),
              ),
            if (_error != null) ...[
              AppSpacing.gapSm,
              Text(
                [
                  apiErrorText(context, _error!),
                  if (_error!.isOffline) context.tr('sale.retry_safe'),
                ].join('\n'),
                style: text.bodySmall?.copyWith(color: AppColors.error),
              ),
            ],
            AppSpacing.gapMd,
            AppButton(
              key: const Key('start-count'),
              label: context.tr('inventory.start'),
              icon: Icons.play_arrow_rounded,
              loading: _busy,
              onPressed: _depot == null || _busy ? null : _start,
            ),
          ],
        ),
      ),
    );
  }
}
