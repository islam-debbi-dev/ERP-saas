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
import '../../../core/models/erp_codes.dart';
import '../../../core/session/session_cubit.dart';
import '../logic/basket.dart';
import 'sale_screen.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

/// "Vendre": vente directe or commande (prévente, TOURNEES), then who it is
/// for (or vente comptoir); the basket opens at `[basePath]/new` or
/// `[basePath]/order` with the client as `extra`.
class SellScreen extends StatefulWidget {
  const SellScreen({super.key, required this.basePath});

  final String basePath;

  @override
  State<SellScreen> createState() => _SellScreenState();
}

class _SellScreenState extends State<SellScreen> {
  SaleMode _mode = SaleMode.direct;

  String get basePath => widget.basePath;

  String get _target => _mode == SaleMode.order ? 'order' : 'new';

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    final canOrder = user?.hasFeature(Feature.tournees) ?? false;
    final canSell = user?.can(Permission.salesCreate) ?? false;
    if (!canSell && _mode == SaleMode.direct && canOrder) {
      _mode = SaleMode.order;
    }
    return BlocProvider(
      create: (_) => ClientsListCubit(getIt<ClientsRepository>())..start(),
      child: Builder(
        builder: (context) {
          final cubit = context.read<ClientsListCubit>();
          return Scaffold(
            appBar: AppBar(title: Text(context.tr('sale.choose_client'))),
            body: Column(
              children: [
                if (canOrder && canSell)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.sm,
                      AppSpacing.lg,
                      0,
                    ),
                    child: SizedBox(
                      width: double.infinity,
                      child: SegmentedButton<SaleMode>(
                        segments: [
                          ButtonSegment(
                            value: SaleMode.direct,
                            icon: const Icon(Icons.local_shipping_outlined),
                            label: Text(context.tr('sale.mode_direct')),
                          ),
                          ButtonSegment(
                            value: SaleMode.order,
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: Text(context.tr('sale.mode_order')),
                          ),
                        ],
                        selected: {_mode},
                        showSelectedIcon: false,
                        onSelectionChanged: (s) =>
                            setState(() => _mode = s.first),
                      ),
                    ),
                  ),
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
                if (_mode == SaleMode.direct)
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
                          padding: EdgeInsets.fromLTRB(
                            AppSpacing.lg,
                            AppSpacing.sm,
                            AppSpacing.lg,
                            CustomBottomNavigation.listEnd(context),
                          ),
                          itemCount: state.items.length,
                          separatorBuilder: (_, _) => AppSpacing.gapSm,
                          itemBuilder: (context, i) {
                            final row = state.items[i];
                            return ClientTile(
                              row: row,
                              onTap: () => context.push(
                                '$basePath/$_target',
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
