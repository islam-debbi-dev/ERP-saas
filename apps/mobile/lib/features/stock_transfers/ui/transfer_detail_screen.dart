import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/share/pdf_share.dart';
import '../../sales/ui/sale_screen.dart' show MoneyErrorCard;
import '../data/stock_transfers_repository.dart';
import '../data/transfer_models.dart';
import '../logic/transfer_cancel_cubit.dart';
import 'transfer_widgets.dart';

/// One chargement / déchargement: its head and its lines, as the API has
/// them, and what can be done with it:
/// - a draft: *Modifier et valider* (the form), or *Abandonner*;
/// - a validated one: *Annuler* with a reason (the goods go back), and the
///   bon de chargement PDF (quantities only, printed by the API);
/// - a cancelled one: read only. Nothing is ever deleted.
class TransferDetailScreen extends StatelessWidget {
  const TransferDetailScreen({
    super.key,
    required this.transferId,
    this.editPath,
  });

  final String transferId;

  /// Where a draft is edited and validated; null = read only.
  final String? editPath;

  @override
  Widget build(BuildContext context) {
    final repo = getIt<StockTransfersRepository>();
    return MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (_) =>
              LoadCubit<StockTransfer>(() => repo.get(transferId))..load(),
        ),
        BlocProvider(
          create: (_) => TransferCancelCubit(repo, transferId: transferId),
        ),
      ],
      child: BlocListener<TransferCancelCubit, TransferCancelState>(
        listenWhen: (a, b) => b.result != null && a.result != b.result,
        listener: (context, s) {
          context.read<LoadCubit<StockTransfer>>().set(s.result!.transfer);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('transfer.done_cancelled'))),
          );
        },
        child: BlocBuilder<LoadCubit<StockTransfer>, LoadState<StockTransfer>>(
          builder: (context, state) {
            final cubit = context.read<LoadCubit<StockTransfer>>();
            final t = state.data;
            return Scaffold(
              appBar: AppBar(
                title: Text(
                  t == null
                      ? context.tr('transfer.title')
                      : context.tr(transferTypeKey(t.type)),
                ),
              ),
              body: LoadStateView<StockTransfer>(
                state: state,
                onRetry: cubit.load,
                skeleton: const ListSkeleton(rows: 4, rowHeight: 72),
                builder: (context, t) => RefreshIndicator(
                  onRefresh: cubit.load,
                  child: ListView(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    children: [
                      const _CancelOutcome(),
                      TransferHeaderCard(transfer: t),
                      AppSpacing.gapMd,
                      TransferLinesCard(lines: t.lines),
                    ],
                  ),
                ),
              ),
              bottomNavigationBar: t == null || editPath == null
                  ? null
                  : _Actions(transfer: t, editPath: editPath!),
            );
          },
        ),
      ),
    );
  }
}

/// A refused cancel (e.g. a truck that already sold the goods cannot give
/// them back under BLOCK), or the dépôts left negative in WARN mode.
class _CancelOutcome extends StatelessWidget {
  const _CancelOutcome();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<TransferCancelCubit, TransferCancelState>(
      builder: (context, s) {
        final transfer = context.read<LoadCubit<StockTransfer>>().state.data;
        String designation(String productId) {
          for (final l in transfer?.lines ?? const <TransferLineDto>[]) {
            if (l.productId == productId) return l.designation;
          }
          return productId;
        }

        final error = s.error;
        final warnings = s.result?.warnings ?? const [];
        if (error == null && warnings.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: error != null
              ? MoneyErrorCard(
                  error: error,
                  stockShort: (productId, available) =>
                      (designation(productId), Qty.format(available)),
                )
              : AppCard(
                  color: AppColors.warning.withValues(alpha: 0.12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        context.tr('transfer.negative_title'),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      for (final w in warnings)
                        Text(
                          context.tr(
                            'transfer.negative_line',
                            args: {
                              'name': designation(w.productId),
                              'qty': Qty.format(w.after),
                            },
                          ),
                        ),
                    ],
                  ),
                ),
        );
      },
    );
  }
}

class _Actions extends StatelessWidget {
  const _Actions({required this.transfer, required this.editPath});

  final StockTransfer transfer;
  final String editPath;

  Future<void> _cancel(BuildContext context) async {
    final cancel = context.read<TransferCancelCubit>();
    final t = transfer;
    final reason = await askText(
      context,
      title: context.tr(
        t.isDraft ? 'transfer.abandon_title' : 'transfer.cancel_title',
      ),
      label: context.tr('transfer.cancel_reason'),
      message: context.tr(
        t.isDraft ? 'transfer.abandon_effect' : 'transfer.cancel_effect',
      ),
      minLength: TransferCancelCubit.minReason,
      confirmLabel: context.tr(
        t.isDraft ? 'transfer.abandon' : 'transfer.cancel',
      ),
    );
    if (reason == null) return;
    await cancel.cancel(reason);
  }

  @override
  Widget build(BuildContext context) {
    final t = transfer;
    if (t.isCancelled) return const SizedBox.shrink();
    final busy = context.watch<TransferCancelCubit>().state.busy;
    final Widget secondary = AppButton(
      key: const Key('cancel-transfer'),
      label: context.tr(t.isDraft ? 'transfer.abandon' : 'transfer.cancel'),
      variant: AppButtonVariant.outline,
      loading: busy,
      onPressed: busy ? null : () => _cancel(context),
    );
    final Widget primary = t.isDraft
        ? AppButton(
            key: const Key('edit-draft'),
            label: context.tr('transfer.edit_validate'),
            icon: Icons.edit_note_rounded,
            onPressed: busy
                ? null
                : () async {
                    final cubit = context.read<LoadCubit<StockTransfer>>();
                    await context.push(editPath);
                    await cubit.load();
                  },
          )
        : AppButton(
            key: const Key('share-pdf'),
            label: context.tr('transfer.pdf'),
            icon: Icons.picture_as_pdf_outlined,
            variant: AppButtonVariant.secondary,
            onPressed: busy
                ? null
                : () => sharePdf(
                    context,
                    path: '/documents/TR/${t.id}/pdf',
                    fileName: pdfName(t.number, 'chargement'),
                  ),
          );
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.sm,
          AppSpacing.lg,
          AppSpacing.sm,
        ),
        child: Row(
          children: [
            Expanded(child: secondary),
            AppSpacing.gapMd,
            Expanded(child: primary),
          ],
        ),
      ),
    );
  }
}
