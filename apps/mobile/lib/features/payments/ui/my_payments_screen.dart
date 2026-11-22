import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/payment.dart';
import '../data/repo/payments_repository.dart';
import 'receipt_view.dart';

/// "Mes versements": what the user collected, newest first.
class MyPaymentsScreen extends StatefulWidget {
  const MyPaymentsScreen({super.key});

  @override
  State<MyPaymentsScreen> createState() => _MyPaymentsScreenState();
}

class _MyPaymentsScreenState extends State<MyPaymentsScreen> {
  late final PagedCubit<Payment> _cubit;

  @override
  void initState() {
    super.initState();
    final me = context.read<SessionCubit>().state.user!.id;
    final repo = getIt<PaymentsRepository>();
    _cubit = PagedCubit<Payment>(
      (cursor) => repo.collectedBy(me, cursor: cursor),
    )..refresh();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('versement.mine'))),
      body: BlocBuilder<PagedCubit<Payment>, PagedState<Payment>>(
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
              icon: Icons.payments_outlined,
              title: context.tr('versement.none'),
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
                  final p = state.items[i];
                  return AppCard(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ReceiptView(payment: p),
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                p.client?.name ?? p.number,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.titleSmall,
                              ),
                              Text(
                                [
                                  context.tr('payment.mode_${p.mode}'),
                                  AlgiersDay.displayDateTime(p.receivedAt),
                                ].join(' · '),
                                style: text.bodySmall?.copyWith(
                                  color: context.textMuted,
                                ),
                              ),
                              if (p.status != 'VALID')
                                Text(
                                  context.tr('payment.status_${p.status}'),
                                  style: text.labelSmall?.copyWith(
                                    color: AppColors.error,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        AmountText(p.amount, style: text.titleSmall),
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
