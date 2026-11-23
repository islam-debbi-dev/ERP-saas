import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/models/product_unit.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/session/session_cubit.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../../catalog/data/models/product.dart';
import '../../catalog/ui/product_picker_screen.dart';
import '../../stock_transfers/data/stock_transfers_repository.dart';
import '../data/inventories_repository.dart';
import '../logic/inventory_count_cubit.dart';
import 'inventories_screen.dart' show InventoryStatusChip;

/// Counting a dépôt: what was counted, product by product (picker with
/// barcode scan, cartons / pièces). **Blind count**: the dépôt's quantity
/// and the écart show only to a user with STOCK_ADJUST, who may also
/// *Valider*. Quantities only.
class InventoryCountScreen extends StatelessWidget {
  const InventoryCountScreen({super.key, required this.inventoryId});

  final String inventoryId;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    final canAdjust = user?.can(Permission.stockAdjust) ?? false;
    return BlocProvider(
      create: (_) => InventoryCountCubit(
        getIt<InventoriesRepository>(),
        getIt<StockTransfersRepository>(),
        inventoryId: inventoryId,
        canValidate: canAdjust,
      )..load(),
      child: _CountView(showExpected: canAdjust),
    );
  }
}

class _CountView extends StatelessWidget {
  const _CountView({required this.showExpected});

  final bool showExpected;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<InventoryCountCubit, InventoryCountState>(
      builder: (context, s) {
        final cubit = context.read<InventoryCountCubit>();
        final inv = s.inventory;
        final title = Text(
          inv?.number ?? context.tr('inventory.title'),
          textDirection: inv == null ? null : TextDirection.ltr,
        );
        if (inv == null) {
          return Scaffold(
            appBar: AppBar(title: title),
            body: s.loading
                ? const ListSkeleton(rows: 4, rowHeight: 64)
                : AppErrorState(
                    title: context.tr('common.load_failed'),
                    message: s.loadError == null
                        ? null
                        : apiErrorText(context, s.loadError!),
                    retryLabel: context.tr('common.retry'),
                    onRetry: cubit.load,
                  ),
          );
        }
        final lines = s.lines;
        return PopScope(
          canPop: !s.dirty,
          onPopInvokedWithResult: (didPop, _) async {
            if (didPop) return;
            final leave = await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: Text(c.tr('transfer.leave_title')),
                content: Text(c.tr('transfer.leave_message')),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(c).pop(false),
                    child: Text(c.tr('transfer.stay')),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(c).pop(true),
                    child: Text(c.tr('transfer.leave')),
                  ),
                ],
              ),
            );
            if ((leave ?? false) && context.mounted) {
              Navigator.of(context).pop();
            }
          },
          child: Scaffold(
            appBar: AppBar(
              title: title,
              actions: [
                if (s.isOpen)
                  IconButton(
                    key: const Key('add-count'),
                    tooltip: context.tr('transfer.add_products'),
                    onPressed: s.busy
                        ? null
                        : () => _openPicker(context, inv.warehouseId),
                    icon: const Icon(Icons.add_circle_outline),
                  ),
              ],
            ),
            body: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                Row(
                  children: [
                    InventoryStatusChip(status: inv.status),
                    AppSpacing.gapSm,
                    Expanded(
                      child: Text(
                        AlgiersDay.displayDateTime(
                          inv.validatedAt ?? inv.createdAt,
                        ),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: context.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
                AppSpacing.gapSm,
                Text(
                  context.tr(
                    showExpected
                        ? 'inventory.hint_adjust'
                        : 'inventory.hint_blind',
                  ),
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: context.textMuted),
                ),
                AppSpacing.gapMd,
                if (lines.isEmpty)
                  AppEmptyState(
                    icon: Icons.qr_code_scanner,
                    title: context.tr('inventory.no_lines'),
                    message: s.isOpen
                        ? context.tr('inventory.no_lines_hint')
                        : null,
                  ),
                for (final l in lines)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: CountLineTile(
                      line: l,
                      showExpected: showExpected,
                      editable: s.isOpen && !s.busy,
                      onTap: () => _edit(context, l),
                      onRemove: () => cubit.remove(cubit.productFor(l)),
                    ),
                  ),
                if (s.error != null) ...[
                  AppSpacing.gapSm,
                  FormErrorBanner(
                    message: [
                      apiErrorText(context, s.error!),
                      if (s.error!.isOffline) context.tr('sale.retry_safe'),
                    ].join('\n'),
                  ),
                ],
              ],
            ),
            bottomNavigationBar: s.isOpen ? _CountBar(state: s) : null,
          ),
        );
      },
    );
  }

  Future<void> _openPicker(BuildContext context, String? depot) {
    final cubit = context.read<InventoryCountCubit>();
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductPickerScreen(
          warehouseId: depot,
          // Blind count: the dépôt's quantity is not shown to the counter.
          showStock: showExpected,
          stockLabelKey: 'transfer.in_depot',
          target: InventoryPickTarget(cubit),
        ),
      ),
    );
  }

  Future<void> _edit(BuildContext context, CountLine line) async {
    final cubit = context.read<InventoryCountCubit>();
    final product = line.product;
    final base = product?.baseUnit;
    if (product == null || base == null) return;
    final picked = await showModalBottomSheet<(ProductUnit, Decimal)>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => AddProductSheet(
        product: product,
        initialUnit: base,
        initialQty: line.counted,
        actionLabelKey: 'inventory.set_count',
        actionIcon: Icons.check,
      ),
    );
    if (picked != null) cubit.set(product, picked.$1, picked.$2);
  }
}

/// The picker's target: a pick adds to the product's count.
class InventoryPickTarget implements PickTarget {
  InventoryPickTarget(this.cubit);

  final InventoryCountCubit cubit;

  @override
  Decimal takenBase(String productId) => Decimal.zero;

  @override
  void add(Product product, ProductUnit unit, Decimal qty) =>
      cubit.add(product, unit, qty);

  @override
  String get addLabelKey => 'inventory.add_count';

  @override
  Widget bottomBar(BuildContext context, VoidCallback done) =>
      BlocBuilder<InventoryCountCubit, InventoryCountState>(
        bloc: cubit,
        builder: (context, s) => Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.sm,
            AppSpacing.lg,
            AppSpacing.sm,
          ),
          child: AppButton(
            label: context.tr(
              'transfer.back_to_form',
              args: {'n': s.lines.length},
            ),
            icon: Icons.checklist_rtl,
            onPressed: done,
          ),
        ),
      );
}

/// A counted product; with STOCK_ADJUST also the dépôt's quantity and the
/// écart (red when short).
class CountLineTile extends StatelessWidget {
  const CountLineTile({
    super.key,
    required this.line,
    required this.showExpected,
    required this.editable,
    required this.onTap,
    required this.onRemove,
  });

  final CountLine line;
  final bool showExpected;
  final bool editable;
  final VoidCallback onTap;
  final VoidCallback onRemove;

  String _qty(Decimal v) {
    final p = line.product;
    return p == null ? Qty.format(v) : stockText(p, v);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final l = line;
    final diff = l.diff;
    return AppCard(
      onTap: editable && l.product?.baseUnit != null ? onTap : null,
      padding: const EdgeInsetsDirectional.fromSTEB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.xs,
        AppSpacing.sm,
      ),
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
                  style: text.titleSmall,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  context.tr(
                    'inventory.counted',
                    args: {'qty': _qty(l.counted)},
                  ),
                  style: text.bodyMedium,
                ),
                if (showExpected && l.expected != null && !l.pending)
                  Text(
                    context.tr(
                      'inventory.expected_diff',
                      args: {
                        'expected': _qty(l.expected!),
                        'diff': Money.ltr(
                          '${diff! > Decimal.zero ? '+' : ''}'
                          '${Qty.format(diff, isolate: false)}',
                        ),
                      },
                    ),
                    style: text.bodySmall?.copyWith(
                      color: diff < Decimal.zero
                          ? AppColors.error
                          : context.textMuted,
                    ),
                  ),
                if (l.pending)
                  Text(
                    context.tr('inventory.not_saved'),
                    style: text.bodySmall?.copyWith(color: AppColors.warning),
                  ),
              ],
            ),
          ),
          if (editable)
            IconButton(
              tooltip: context.tr('transfer.remove_line'),
              onPressed: onRemove,
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
    );
  }
}

class _CountBar extends StatelessWidget {
  const _CountBar({required this.state});

  final InventoryCountState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final cubit = context.read<InventoryCountCubit>();
    final save = AppButton(
      key: const Key('save-count'),
      label: context.tr('transfer.save_draft'),
      variant: cubit.canValidate
          ? AppButtonVariant.secondary
          : AppButtonVariant.primary,
      loading: s.busy && !cubit.canValidate,
      onPressed: s.busy || !s.dirty
          ? null
          : () async {
              final messenger = ScaffoldMessenger.of(context);
              final saved = context.tr('inventory.saved');
              if (await cubit.save()) {
                messenger.showSnackBar(SnackBar(content: Text(saved)));
              }
            },
    );
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.sm,
          AppSpacing.lg,
          AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          border: Border(top: BorderSide(color: context.fieldBorder)),
        ),
        child: Row(
          children: [
            Expanded(child: save),
            if (cubit.canValidate) ...[
              AppSpacing.gapMd,
              Expanded(
                child: AppButton(
                  key: const Key('validate-count'),
                  label: context.tr('transfer.validate'),
                  icon: Icons.check_circle_outline,
                  loading: s.busy,
                  onPressed: s.busy || s.lines.isEmpty
                      ? null
                      : () async {
                          final ok = await showDialog<bool>(
                            context: context,
                            builder: (c) => AlertDialog(
                              title: Text(c.tr('inventory.confirm_title')),
                              content: Text(
                                c.tr(
                                  'inventory.confirm_message',
                                  args: {'n': s.lines.length},
                                ),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.of(c).pop(false),
                                  child: Text(c.tr('common.cancel')),
                                ),
                                FilledButton(
                                  key: const Key('confirm-count'),
                                  onPressed: () => Navigator.of(c).pop(true),
                                  child: Text(c.tr('transfer.validate')),
                                ),
                              ],
                            ),
                          );
                          if (ok ?? false) await cubit.validate();
                        },
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
