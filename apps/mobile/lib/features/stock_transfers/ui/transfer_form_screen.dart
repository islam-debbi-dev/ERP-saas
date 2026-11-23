import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/product_unit.dart';
import '../../../core/network/error_messages.dart';
import '../../catalog/data/models/product.dart';
import '../../catalog/ui/product_picker_screen.dart';
import '../../sales/ui/sale_screen.dart' show MoneyErrorCard;
import '../../sales/ui/widgets/qty_stepper.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../data/stock_transfers_repository.dart';
import '../data/transfer_models.dart';
import '../logic/transfer_editor_cubit.dart';
import '../logic/transfer_form.dart';
import 'transfer_result_view.dart';

/// Nouveau chargement / déchargement, or a draft being edited: the truck,
/// the dépôt, the lines (picker, barcode scan, cartons / pièces, what the
/// source has), *Enregistrer* (a draft, no effect on stock) and *Valider*
/// (after a confirm with the line count and the quantities).
///
/// Pops with `true` once something was saved or validated, so the list
/// reloads. Quantities only: no price, cost or value anywhere.
class TransferFormScreen extends StatelessWidget {
  const TransferFormScreen({
    super.key,
    this.type = TransferType.load,
    this.truckId,
    this.transferId,
    this.unloadRest = false,
  });

  final String type;

  /// The truck chosen before (Camions tab, "Mon camion").
  final String? truckId;

  /// A draft to edit.
  final String? transferId;

  /// Déchargement du soir: the lines start as everything on the truck.
  final bool unloadRest;

  @override
  Widget build(BuildContext context) => BlocProvider(
    create: (_) => TransferEditorCubit(
      getIt<StockTransfersRepository>(),
      form: TransferForm(type: type, truckId: truckId),
      transferId: transferId,
      unloadRest: unloadRest,
    )..load(),
    child: const _FormView(),
  );
}

class _FormView extends StatelessWidget {
  const _FormView();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<TransferEditorCubit, TransferEditorState>(
      builder: (context, s) {
        final cubit = context.read<TransferEditorCubit>();
        final result = s.result;
        if (result != null) {
          return TransferResultView(
            result: result,
            lines: s.form.lines,
            onDone: () => Navigator.of(context).pop(true),
          );
        }
        final title = context.tr(
          cubit.transferId != null
              ? 'transfer.edit_title'
              : (s.form.isLoad ? 'transfer.new_load' : 'transfer.new_unload'),
        );
        if (s.loading || s.loadError != null) {
          return Scaffold(
            appBar: AppBar(title: Text(title)),
            body: s.loading
                ? const ListSkeleton(rows: 4, rowHeight: 72)
                : AppErrorState(
                    title: context.tr('common.load_failed'),
                    message: apiErrorText(context, s.loadError!),
                    retryLabel: context.tr('common.retry'),
                    onRetry: cubit.load,
                  ),
          );
        }
        return PopScope(
          canPop: !s.dirty || s.form.isEmpty,
          onPopInvokedWithResult: (didPop, _) async {
            if (didPop) return;
            final leave = await _confirmLeave(context);
            if (leave && context.mounted) {
              Navigator.of(context).pop(s.transferId != null);
            }
          },
          child: Scaffold(
            appBar: AppBar(title: Text(title)),
            body: _Body(state: s),
            bottomNavigationBar: _ActionBar(state: s),
          ),
        );
      },
    );
  }
}

Future<bool> _confirmLeave(BuildContext context) async =>
    await showDialog<bool>(
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
    ) ??
    false;

class _Body extends StatelessWidget {
  const _Body({required this.state});

  final TransferEditorState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final cubit = context.read<TransferEditorCubit>();
    final text = Theme.of(context).textTheme;
    final f = s.form;
    final truck = s.truck;
    final depot = s.depot;
    final sourceKey = f.isLoad ? 'transfer.depot_from' : 'transfer.depot_to';
    final errors = s.showErrors ? f.errors() : const <String>[];
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xl,
      ),
      children: [
        _PlaceTile(
          icon: Icons.local_shipping_outlined,
          label: context.tr('transfer.truck'),
          value: truck?.label,
          ltr: true,
          onTap: s.busy ? null : () => _pickTruck(context, s),
        ),
        AppSpacing.gapSm,
        _PlaceTile(
          icon: Icons.warehouse_outlined,
          label: context.tr(sourceKey),
          value: depot?.label,
          onTap: s.busy || s.depots.length < 2
              ? null
              : () => _pickDepot(context, s),
        ),
        AppSpacing.gapLg,
        Row(
          children: [
            Expanded(
              child: Text(
                context.tr('truck.line_count', args: {'n': f.lines.length}),
                style: text.titleSmall,
              ),
            ),
            TextButton.icon(
              onPressed: s.busy || f.fromId == null
                  ? null
                  : () => _openPicker(context, s),
              icon: const Icon(Icons.add),
              label: Text(context.tr('transfer.add_products')),
            ),
          ],
        ),
        if (f.lines.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Text(
              context.tr('transfer.no_lines'),
              style: text.bodyMedium?.copyWith(color: context.textMuted),
            ),
          ),
        for (final l in f.lines)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: TransferLineTile(
              line: l,
              available: s.availableFor(l.productId),
              availableKey: f.isLoad
                  ? 'transfer.in_depot'
                  : 'transfer.on_truck',
              short: s.shortProductId == l.productId,
              showIssue: s.showErrors,
              enabled: !s.busy,
              onTap: () => _editLine(context, s, l),
              onStep: (by) => cubit.step(l.productId, by),
              onRemove: () => cubit.remove(l.productId),
            ),
          ),
        AppSpacing.gapMd,
        TextFormField(
          initialValue: f.note,
          maxLength: 255,
          enabled: !s.busy,
          decoration: InputDecoration(labelText: context.tr('transfer.note')),
          onChanged: cubit.setNote,
        ),
        if (errors.isNotEmpty) ...[
          AppSpacing.gapSm,
          FormErrorBanner(message: errors.map((e) => context.tr(e)).join('\n')),
        ],
        if (s.error != null) ...[
          AppSpacing.gapSm,
          MoneyErrorCard(
            error: s.error!,
            stockShort: (productId, available) {
              final line = f.lineOf(productId);
              return line == null
                  ? null
                  : (
                      line.product.designation,
                      stockText(line.product, available),
                    );
            },
          ),
        ],
      ],
    );
  }

  Future<void> _pickTruck(BuildContext context, TransferEditorState s) async {
    final cubit = context.read<TransferEditorCubit>();
    final id = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (c) => _ChoiceSheet(
        title: c.tr('transfer.pick_truck'),
        empty: c.tr('transfer.no_trucks'),
        options: [
          for (final t in s.trucks)
            (t.id, t.label, t.driver?.fullName ?? c.tr('trucks.no_driver')),
        ],
        selected: s.form.truckId,
        ltr: true,
      ),
    );
    if (id != null) await cubit.setTruck(id);
  }

  Future<void> _pickDepot(BuildContext context, TransferEditorState s) async {
    final cubit = context.read<TransferEditorCubit>();
    final id = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (c) => _ChoiceSheet(
        title: c.tr('transfer.pick_depot'),
        empty: c.tr('transfer.no_depots'),
        options: [for (final d in s.depots) (d.id, d.label, null)],
        selected: s.form.depotId,
      ),
    );
    if (id != null) await cubit.setDepot(id);
  }

  Future<void> _openPicker(BuildContext context, TransferEditorState s) {
    final cubit = context.read<TransferEditorCubit>();
    final load = s.form.isLoad;
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductPickerScreen(
          warehouseId: s.form.fromId,
          stockLabelKey: load ? 'transfer.in_depot' : 'transfer.on_truck',
          target: TransferPickTarget(cubit),
        ),
      ),
    );
  }

  Future<void> _editLine(
    BuildContext context,
    TransferEditorState s,
    TransferLineDraft line,
  ) async {
    final cubit = context.read<TransferEditorCubit>();
    final available = s.availableFor(line.productId);
    final picked = await showModalBottomSheet<(ProductUnit, Decimal)>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => AddProductSheet(
        product: line.product,
        initialUnit: line.unit,
        initialQty: line.qty,
        leftBase: available,
        stockLabelKey: s.form.isLoad
            ? 'transfer.in_depot'
            : 'transfer.on_truck',
        actionLabelKey: 'transfer.set_line',
        actionIcon: Icons.check,
      ),
    );
    if (picked != null) cubit.setLine(line.productId, picked.$1, picked.$2);
  }
}

/// The picker's target: lines of the chargement being prepared.
class TransferPickTarget implements PickTarget {
  TransferPickTarget(this.cubit);

  final TransferEditorCubit cubit;

  @override
  Decimal takenBase(String productId) => cubit.takenBase(productId);

  @override
  void add(Product product, ProductUnit unit, Decimal qty) =>
      cubit.add(product, unit, qty);

  @override
  String get addLabelKey => 'transfer.add_line';

  @override
  Widget bottomBar(BuildContext context, VoidCallback done) =>
      BlocBuilder<TransferEditorCubit, TransferEditorState>(
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
              args: {'n': s.form.lines.length},
            ),
            icon: Icons.checklist_rtl,
            onPressed: done,
          ),
        ),
      );
}

/// The truck or the dépôt of the form.
class _PlaceTile extends StatelessWidget {
  const _PlaceTile({
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
    this.ltr = false,
  });

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;
  final bool ltr;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppSpacing.minTouch - 8),
        child: Row(
          children: [
            Icon(icon, color: Theme.of(context).colorScheme.primary),
            AppSpacing.gapMd,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                  Text(
                    value ?? context.tr('transfer.choose'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: ltr && value != null
                        ? TextDirection.ltr
                        : null,
                    textAlign: TextAlign.start,
                    style: text.titleSmall?.copyWith(
                      color: value == null ? AppColors.error : null,
                    ),
                  ),
                ],
              ),
            ),
            if (onTap != null)
              Icon(Icons.expand_more_rounded, color: context.textMuted),
          ],
        ),
      ),
    );
  }
}

/// A list of (id, label, subtitle) to choose one from.
class _ChoiceSheet extends StatelessWidget {
  const _ChoiceSheet({
    required this.title,
    required this.empty,
    required this.options,
    this.selected,
    this.ltr = false,
  });

  final String title;
  final String empty;
  final List<(String, String, String?)> options;
  final String? selected;
  final bool ltr;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.7,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Text(title, style: text.titleMedium),
            ),
            AppSpacing.gapSm,
            if (options.isEmpty)
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Text(empty, style: text.bodyMedium),
              ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final (id, label, sub) in options)
                    ListTile(
                      minTileHeight: AppSpacing.minTouch,
                      selected: id == selected,
                      leading: Icon(
                        id == selected
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                      ),
                      title: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: ltr ? TextDirection.ltr : null,
                        textAlign: TextAlign.start,
                      ),
                      subtitle: sub == null
                          ? null
                          : Text(
                              sub,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                      onTap: () => Navigator.of(context).pop(id),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One line of the form: product, quantity with − / +, what the source has,
/// and why it cannot go (zero, not a whole number, not enough stock).
class TransferLineTile extends StatelessWidget {
  const TransferLineTile({
    super.key,
    required this.line,
    required this.onTap,
    required this.onStep,
    required this.onRemove,
    this.available,
    this.availableKey = 'transfer.in_depot',
    this.short = false,
    this.showIssue = false,
    this.enabled = true,
  });

  final TransferLineDraft line;

  /// Base quantity at the source; null while unknown.
  final Decimal? available;
  final String availableKey;

  /// The API answered STOCK_INSUFFICIENT for this product.
  final bool short;
  final bool showIssue;
  final bool enabled;
  final VoidCallback onTap;
  final void Function(int by) onStep;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final l = line;
    final issue = TransferForm.issueOf(l);
    final over = available != null && l.qtyBase > available!;
    final red = short || (showIssue && issue != null);
    return AppCard(
      onTap: enabled ? onTap : null,
      color: red ? AppColors.error.withValues(alpha: 0.08) : null,
      padding: const EdgeInsetsDirectional.fromSTEB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.xs,
        AppSpacing.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l.product.designation,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall,
                ),
              ),
              IconButton(
                tooltip: context.tr('transfer.remove_line'),
                onPressed: enabled ? onRemove : null,
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l.unit.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodyMedium,
                    ),
                    if (l.unit.factorToBase != Decimal.one)
                      Text(
                        Qty.withUnit(
                          l.qtyBase,
                          l.product.baseUnit?.unitCode ?? '',
                        ),
                        style: text.bodySmall?.copyWith(
                          color: context.textMuted,
                        ),
                      ),
                  ],
                ),
              ),
              QtyStepper(
                label: Qty.format(l.qty),
                onDecrement: enabled ? () => onStep(-1) : () {},
                onIncrement: enabled ? () => onStep(1) : null,
                onTapLabel: enabled ? onTap : null,
                decrementTooltip: context.tr('sale.less'),
                incrementTooltip: context.tr('sale.more'),
              ),
              AppSpacing.gapSm,
            ],
          ),
          if (available != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: StockLabel(
                leftBase: available!,
                product: l.product,
                labelKey: availableKey,
              ),
            ),
          if (short || over)
            Text(
              context.tr('transfer.short_line'),
              style: text.bodySmall?.copyWith(
                color: AppColors.error,
                fontWeight: FontWeight.w600,
              ),
            ),
          if (showIssue && issue != null)
            Text(
              context.tr(
                issue == LineIssue.notPositive
                    ? 'transfer.issue_zero'
                    : 'transfer.issue_whole',
              ),
              style: text.bodySmall?.copyWith(color: AppColors.error),
            ),
        ],
      ),
    );
  }
}

/// Bottom bar: *Enregistrer* (draft) and *Valider*.
class _ActionBar extends StatelessWidget {
  const _ActionBar({required this.state});

  final TransferEditorState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final cubit = context.read<TransferEditorCubit>();
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
            Expanded(
              child: AppButton(
                key: const Key('save-draft'),
                label: context.tr('transfer.save_draft'),
                variant: AppButtonVariant.secondary,
                onPressed: s.busy
                    ? null
                    : () async {
                        final messenger = ScaffoldMessenger.of(context);
                        final saved = context.tr('transfer.saved');
                        if (await cubit.save()) {
                          messenger.showSnackBar(
                            SnackBar(content: Text(saved)),
                          );
                        }
                      },
              ),
            ),
            AppSpacing.gapMd,
            Expanded(
              child: AppButton(
                key: const Key('validate'),
                label: context.tr('transfer.validate'),
                icon: Icons.check_circle_outline,
                loading: s.busy,
                onPressed: s.busy
                    ? null
                    : () async {
                        if (!s.form.canSave(forValidation: true)) {
                          await cubit.validate(); // shows the errors
                          return;
                        }
                        if (await confirmTransfer(context, s)) {
                          await cubit.validate();
                        }
                      },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Valider le chargement ?" with the truck, the line count and the
/// quantities per unit.
Future<bool> confirmTransfer(
  BuildContext context,
  TransferEditorState s,
) async {
  final f = s.form;
  final totals = f.totalsByUnit();
  return await showDialog<bool>(
        context: context,
        builder: (c) {
          final text = Theme.of(c).textTheme;
          return AlertDialog(
            title: Text(
              c.tr(
                f.isLoad
                    ? 'transfer.confirm_load_title'
                    : 'transfer.confirm_unload_title',
              ),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (s.truck != null)
                  Text(
                    s.truck!.label,
                    textDirection: TextDirection.ltr,
                    style: text.titleSmall,
                  ),
                if (s.depot != null)
                  Text(s.depot!.label, style: text.bodyMedium),
                AppSpacing.gapSm,
                Text(
                  c.tr('truck.line_count', args: {'n': f.lines.length}),
                  style: text.bodyLarge,
                ),
                Text(
                  c.tr(
                    'transfer.confirm_total',
                    args: {
                      'qty': Money.ltr(
                        [
                          for (final e in totals.entries)
                            '${Qty.format(e.value, isolate: false)} ${e.key}',
                        ].join(' · '),
                      ),
                    },
                  ),
                  style: text.titleSmall,
                ),
                AppSpacing.gapSm,
                Text(
                  c.tr('transfer.confirm_effect'),
                  style: text.bodySmall?.copyWith(color: c.textMuted),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(c).pop(false),
                child: Text(c.tr('common.cancel')),
              ),
              FilledButton(
                key: const Key('confirm-validate'),
                onPressed: () => Navigator.of(c).pop(true),
                child: Text(c.tr('transfer.validate')),
              ),
            ],
          );
        },
      ) ??
      false;
}
