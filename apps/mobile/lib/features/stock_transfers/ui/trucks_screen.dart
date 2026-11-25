import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/api_result.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../../catalog/ui/product_picker_screen.dart' show stockText;
import '../../team/data/team_models.dart';
import '../data/stock_transfers_repository.dart';
import '../data/transfer_models.dart';
import '../logic/transfer_form.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

/// "Camions": every truck in reach, `code · name`, with its driver of today
/// (`Warehouse.assignedUser`, phase 36) or *Sans chauffeur*. Opens a
/// truck's stock at `[basePath]/<id>`.
class TrucksScreen extends StatelessWidget {
  const TrucksScreen({super.key, required this.basePath});

  final String basePath;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          LoadCubit<List<TruckOption>>(getIt<StockTransfersRepository>().trucks)
            ..load(),
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('trucks.title'))),
        body:
            BlocBuilder<
              LoadCubit<List<TruckOption>>,
              LoadState<List<TruckOption>>
            >(
              builder: (context, state) {
                final cubit = context.read<LoadCubit<List<TruckOption>>>();
                return LoadStateView<List<TruckOption>>(
                  state: state,
                  onRetry: cubit.load,
                  skeleton: const ListSkeleton(),
                  builder: (context, trucks) => RefreshIndicator(
                    onRefresh: cubit.load,
                    child: trucks.isEmpty
                        ? ListView(
                            children: [
                              AppEmptyState(
                                icon: Icons.local_shipping_outlined,
                                title: context.tr('transfer.no_trucks'),
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: EdgeInsetsDirectional.fromSTEB(
                              AppSpacing.lg,
                              AppSpacing.md,
                              AppSpacing.lg,
                              CustomBottomNavigation.listEnd(context),
                            ),
                            itemCount: trucks.length,
                            separatorBuilder: (_, _) => AppSpacing.gapSm,
                            itemBuilder: (context, i) => TruckTile(
                              truck: trucks[i],
                              onTap: () async {
                                await context.push('$basePath/${trucks[i].id}');
                                await cubit.load();
                              },
                            ),
                          ),
                  ),
                );
              },
            ),
      ),
    );
  }
}

/// A truck and who drives it today.
class TruckTile extends StatelessWidget {
  const TruckTile({super.key, required this.truck, this.onTap});

  final TruckOption truck;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final driver = truck.driver;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Icon(
            Icons.local_shipping_outlined,
            color: Theme.of(context).colorScheme.primary,
          ),
          AppSpacing.gapMd,
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  truck.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textDirection: TextDirection.ltr,
                  textAlign: TextAlign.start,
                  style: text.titleSmall,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  driver == null
                      ? context.tr('trucks.no_driver')
                      : context.tr(
                          'trucks.driver_today',
                          args: {'name': driver.fullName},
                        ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(
                    color: driver == null
                        ? AppColors.warning
                        : context.textMuted,
                  ),
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

/// What a truck holds now (quantities only, largest unit first), with
/// *Charger* and *Décharger le reste* for a user with STOCK_TRANSFER.
class TruckStockScreen extends StatelessWidget {
  const TruckStockScreen({
    super.key,
    required this.truckId,
    required this.basePath,
  });

  final String truckId;

  /// The truck's own path: `[basePath]/load` and `[basePath]/unload`.
  final String basePath;

  @override
  Widget build(BuildContext context) {
    final repo = getIt<StockTransfersRepository>();
    final user = context.watch<SessionCubit>().state.user;
    final canTransfer = user?.can(Permission.stockTransfer) ?? false;
    return BlocProvider(
      create: (_) => LoadCubit<TruckStock>(() async {
        final trucks = await repo.trucks();
        if (trucks case Failure(:final error)) return ApiResult.failure(error);
        final levels = await repo.levels(truckId);
        if (levels case Failure(:final error)) return ApiResult.failure(error);
        TruckOption? truck;
        for (final t in (trucks as Success<List<TruckOption>>).data) {
          if (t.id == truckId) truck = t;
        }
        return ApiResult.success(
          TruckStock(
            truck: truck,
            lines: [
              for (final l in (levels as Success<List<StockLevel>>).data)
                if (l.qtyBase != Decimal.zero) l,
            ],
          ),
        );
      })..load(),
      child: BlocBuilder<LoadCubit<TruckStock>, LoadState<TruckStock>>(
        builder: (context, state) {
          final cubit = context.read<LoadCubit<TruckStock>>();
          final data = state.data;
          return Scaffold(
            appBar: AppBar(
              title: Text(
                data?.truck?.label ?? context.tr('trucks.stock_title'),
                textDirection: data?.truck == null ? null : TextDirection.ltr,
              ),
            ),
            body: LoadStateView<TruckStock>(
              state: state,
              onRetry: cubit.load,
              skeleton: const ListSkeleton(rows: 5, rowHeight: 64),
              builder: (context, s) => RefreshIndicator(
                onRefresh: cubit.load,
                child: _StockList(stock: s),
              ),
            ),
            bottomNavigationBar: !canTransfer || data == null
                ? null
                : SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        AppSpacing.sm,
                        AppSpacing.lg,
                        AppSpacing.sm,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: AppButton(
                              key: const Key('truck-load'),
                              label: context.tr('trucks.load'),
                              icon: Icons.move_to_inbox_outlined,
                              variant: AppButtonVariant.secondary,
                              onPressed: () async {
                                await context.push('$basePath/load');
                                await cubit.load();
                              },
                            ),
                          ),
                          AppSpacing.gapMd,
                          Expanded(
                            child: AppButton(
                              key: const Key('truck-unload'),
                              label: context.tr('transfer.unload_rest'),
                              icon: Icons.outbox_outlined,
                              onPressed: data.lines.isEmpty
                                  ? null
                                  : () async {
                                      await context.push('$basePath/unload');
                                      await cubit.load();
                                    },
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
          );
        },
      ),
    );
  }
}

/// A truck and what is on it.
class TruckStock {
  const TruckStock({required this.truck, required this.lines});

  /// Null when the truck is no longer in reach (or switched off).
  final TruckOption? truck;
  final List<StockLevel> lines;
}

class _StockList extends StatelessWidget {
  const _StockList({required this.stock});

  final TruckStock stock;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final driver = stock.truck?.driver;
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(
          driver == null
              ? context.tr('trucks.no_driver')
              : context.tr(
                  'trucks.driver_today',
                  args: {'name': driver.fullName},
                ),
          style: text.bodyMedium?.copyWith(color: context.textMuted),
        ),
        AppSpacing.gapMd,
        Text(context.tr('truck.stock'), style: text.titleSmall),
        AppSpacing.gapSm,
        if (stock.lines.isEmpty)
          AppEmptyState(
            icon: Icons.inventory_2_outlined,
            title: context.tr('truck.empty'),
          ),
        for (final l in stock.lines)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: AppCard(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l.designation,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodyMedium,
                        ),
                        Text(
                          l.reference,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall?.copyWith(
                            color: context.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  AppSpacing.gapSm,
                  Text(
                    stockText(productOf(l), l.qtyBase),
                    style: text.titleSmall?.copyWith(
                      color: l.qtyBase < Decimal.zero ? AppColors.error : null,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
