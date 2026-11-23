import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../data/stock_transfers_repository.dart';
import '../data/transfer_models.dart';
import 'transfer_widgets.dart';

/// One chargement / déchargement: its head and its lines, as the API has
/// them. Quantities only.
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
    return BlocProvider(
      create: (_) => LoadCubit<StockTransfer>(
        () => getIt<StockTransfersRepository>().get(transferId),
      )..load(),
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
                    TransferHeaderCard(transfer: t),
                    AppSpacing.gapMd,
                    TransferLinesCard(lines: t.lines),
                  ],
                ),
              ),
            ),
            bottomNavigationBar: t == null
                ? null
                : _Actions(transfer: t, editPath: editPath),
          );
        },
      ),
    );
  }
}

/// A draft: *Modifier / Valider* opens the form (the validation and its
/// confirm live there, with its Idempotency-Key).
class _Actions extends StatelessWidget {
  const _Actions({required this.transfer, this.editPath});

  final StockTransfer transfer;
  final String? editPath;

  @override
  Widget build(BuildContext context) {
    final t = transfer;
    final edit = editPath;
    if (!t.isDraft || edit == null) return const SizedBox.shrink();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.sm,
          AppSpacing.lg,
          AppSpacing.sm,
        ),
        child: AppButton(
          key: const Key('edit-draft'),
          label: context.tr('transfer.edit_validate'),
          icon: Icons.edit_note_rounded,
          onPressed: () async {
            final cubit = context.read<LoadCubit<StockTransfer>>();
            await context.push(edit);
            await cubit.load();
          },
        ),
      ),
    );
  }
}
