import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/search_input.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../clients/data/models/client.dart';
import '../../clients/data/repo/clients_repository.dart';
import '../../clients/logic/clients_list_cubit.dart';
import '../../clients/ui/clients_screen.dart';
import '../logic/basket.dart';

/// "Vendre": pick who the sale is for (or vente comptoir), then the basket
/// opens at `[basePath]/new` with the client as `extra`.
class SellScreen extends StatelessWidget {
  const SellScreen({super.key, required this.basePath});

  final String basePath;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ClientsListCubit(getIt<ClientsRepository>())..start(),
      child: Builder(
        builder: (context) {
          final cubit = context.read<ClientsListCubit>();
          return Scaffold(
            appBar: AppBar(title: Text(context.tr('sale.choose_client'))),
            body: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.sm,
                    AppSpacing.lg,
                    AppSpacing.sm,
                  ),
                  child: SearchInput(
                    hint: context.tr('clients.search_hint'),
                    onChanged: cubit.search,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                  ),
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(AppSpacing.minTouch),
                    ),
                    onPressed: () => context.push('$basePath/new'),
                    icon: const Icon(Icons.storefront_outlined),
                    label: Text(context.tr('sale.counter_sale')),
                  ),
                ),
                AppSpacing.gapSm,
                Expanded(
                  child: BlocBuilder<ClientsListCubit, PagedState<ClientRow>>(
                    builder: (context, state) {
                      if (state.isFirstLoad) return const ListSkeleton();
                      if (state.status == PagedStatus.failure &&
                          state.items.isEmpty) {
                        return AppErrorState(
                          title: context.tr('common.load_failed'),
                          message: state.error == null
                              ? null
                              : apiErrorText(context, state.error!),
                          retryLabel: context.tr('common.retry'),
                          onRetry: cubit.refresh,
                        );
                      }
                      if (state.isEmpty) {
                        return AppEmptyState(
                          icon: Icons.people_outline,
                          title: context.tr('clients.empty_title'),
                        );
                      }
                      return NotificationListener<ScrollNotification>(
                        onNotification: (n) {
                          if (n.metrics.extentAfter < 400) cubit.loadMore();
                          return false;
                        },
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(
                            AppSpacing.lg,
                            AppSpacing.sm,
                            AppSpacing.lg,
                            AppSpacing.navClearance,
                          ),
                          itemCount: state.items.length,
                          separatorBuilder: (_, _) => AppSpacing.gapSm,
                          itemBuilder: (context, i) {
                            final row = state.items[i];
                            return ClientTile(
                              row: row,
                              onTap: () => context.push(
                                '$basePath/new',
                                extra: basketClientOfRow(row),
                              ),
                            );
                          },
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

BasketClient basketClientOfRow(ClientRow r) =>
    BasketClient(id: r.id, code: r.code, name: r.name, balance: r.balance);

BasketClient basketClientOf(Client c) => BasketClient(
  id: c.id,
  code: c.code,
  name: c.name,
  balance: c.balance,
  creditLimit: c.creditLimit,
);
