import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/paging/paged_cubit.dart';
import '../data/models/sale.dart';
import '../data/models/sale_summary.dart';
import '../data/repo/sales_repository.dart';
import 'sale_result_view.dart';
import 'widgets/doc_status_chip.dart';

/// "Mes ventes": the user's sales (the API scopes a seller to his own),
/// each opening the document with "Partager PDF".
class MySalesScreen extends StatefulWidget {
  const MySalesScreen({super.key});

  @override
  State<MySalesScreen> createState() => _MySalesScreenState();
}

class _MySalesScreenState extends State<MySalesScreen> {
  final _repo = getIt<SalesRepository>();
  late final PagedCubit<SaleSummary> _cubit = PagedCubit<SaleSummary>(
    (cursor) => _repo.list(cursor: cursor),
  )..refresh();

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('sale.mine'))),
      body: BlocBuilder<PagedCubit<SaleSummary>, PagedState<SaleSummary>>(
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
          if (state.isEmpty) {
            return AppEmptyState(
              icon: Icons.receipt_outlined,
              title: context.tr('sale.none'),
            );
          }
          return RefreshIndicator(
            onRefresh: _cubit.refresh,
            child: NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (n.metrics.extentAfter < 400) _cubit.loadMore();
                return false;
              },
              child: ListView.separated(
                padding: const EdgeInsets.all(AppSpacing.lg),
                itemCount: state.items.length,
                separatorBuilder: (_, _) => AppSpacing.gapSm,
                itemBuilder: (context, i) {
                  final s = state.items[i];
                  return AppCard(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => SaleDetailScreen(saleId: s.id),
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                s.client?.name ?? context.tr('sale.counter'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.titleSmall,
                              ),
                              Text(
                                [
                                  s.number ?? s.type,
                                  AlgiersDay.display(s.documentDate),
                                ].join(' · '),
                                style: text.bodySmall?.copyWith(
                                  color: context.textMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        AppSpacing.gapSm,
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            AmountText(s.totalTtc, style: text.titleSmall),
                            const SizedBox(height: AppSpacing.xxs),
                            DocStatusChip(status: s.status),
                          ],
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          );
        },
      ),
    );
  }
}

/// One past sale, as the API has it, with "Partager PDF".
class SaleDetailScreen extends StatelessWidget {
  const SaleDetailScreen({super.key, required this.saleId});

  final String saleId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LoadCubit<SaleResult>(() async {
        final r = await getIt<SalesRepository>().get(saleId);
        return switch (r) {
          Success(:final data) => ApiResult.success(
            SaleResult(sale: data, change: Decimal.zero),
          ),
          Failure(:final error) => ApiResult.failure(error),
        };
      })..load(),
      child: BlocBuilder<LoadCubit<SaleResult>, LoadState<SaleResult>>(
        builder: (context, state) => state.data != null
            ? SaleResultView(result: state.data!, justSaved: false)
            : Scaffold(
                appBar: AppBar(),
                body: LoadStateView<SaleResult>(
                  state: state,
                  onRetry: context.read<LoadCubit<SaleResult>>().load,
                  builder: (_, _) => const SizedBox.shrink(),
                ),
              ),
      ),
    );
  }
}
