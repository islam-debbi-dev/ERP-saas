import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
  const TransferDetailScreen({super.key, required this.transferId});

  final String transferId;

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
          );
        },
      ),
    );
  }
}
