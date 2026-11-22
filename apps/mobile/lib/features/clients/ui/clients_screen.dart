import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/search_input.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/geo/geo_capture.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/client.dart';
import '../data/repo/clients_repository.dart';
import '../logic/clients_list_cubit.dart';

/// The client list of a field role: search, debtors, near me (GEO_CHECK),
/// new client (CLIENTS_CREATE). [basePath] is the tab's root
/// (`/seller/clients`); a client opens at `basePath/:id`.
class ClientsScreen extends StatelessWidget {
  const ClientsScreen({super.key, required this.basePath});

  final String basePath;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ClientsListCubit(getIt<ClientsRepository>())..start(),
      child: _ClientsView(basePath: basePath),
    );
  }
}

class _ClientsView extends StatefulWidget {
  const _ClientsView({required this.basePath});

  final String basePath;

  @override
  State<_ClientsView> createState() => _ClientsViewState();
}

class _ClientsViewState extends State<_ClientsView> {
  bool _locating = false;

  Future<void> _toggleNear(ClientsListCubit cubit) async {
    if (cubit.filter.near != null) {
      await cubit.nearMe(null);
      setState(() {});
      return;
    }
    setState(() => _locating = true);
    final fix = await captureGeo(context);
    if (!mounted) return;
    setState(() => _locating = false);
    if (fix == null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.tr('geo.no_fix'))));
      return;
    }
    await cubit.nearMe(fix);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<ClientsListCubit>();
    final user = context.watch<SessionCubit>().state.user;
    final canCreate = user?.can(Permission.clientsCreate) ?? false;
    final hasGeo = user?.hasFeature(Feature.geoCheck) ?? false;
    final f = cubit.filter;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('clients.title'))),
      floatingActionButton: canCreate
          ? Padding(
              padding: const EdgeInsets.only(bottom: 88),
              child: FloatingActionButton.extended(
                heroTag: 'new-client',
                onPressed: () async {
                  final created = await context.push<Client>(
                    '${widget.basePath}/new',
                  );
                  if (created != null && context.mounted) {
                    await cubit.refresh();
                    if (context.mounted) {
                      context.push('${widget.basePath}/${created.id}');
                    }
                  }
                },
                icon: const Icon(Icons.person_add_alt_1_outlined),
                label: Text(context.tr('clients.new')),
              ),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(
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
          SizedBox(
            height: AppSpacing.minTouch,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              children: [
                AppChoiceChip(
                  label: context.tr('clients.debtors'),
                  icon: Icons.account_balance_wallet_outlined,
                  selected: f.debtorsOnly,
                  onTap: () async {
                    await cubit.toggleDebtors();
                    if (mounted) setState(() {});
                  },
                ),
                if (hasGeo) ...[
                  AppSpacing.gapSm,
                  AppChoiceChip(
                    label: context.tr(
                      _locating ? 'geo.locating' : 'clients.near_me',
                    ),
                    icon: Icons.near_me_outlined,
                    selected: f.near != null,
                    onTap: _locating ? () {} : () => _toggleNear(cubit),
                  ),
                ],
              ],
            ),
          ),
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
                    message: context.tr('clients.empty_message'),
                  );
                }
                return RefreshIndicator(
                  onRefresh: cubit.refresh,
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (n) {
                      if (n.metrics.extentAfter < 400) cubit.loadMore();
                      return false;
                    },
                    child: ListView.separated(
                      padding: const EdgeInsetsDirectional.fromSTEB(
                        AppSpacing.lg,
                        AppSpacing.sm,
                        AppSpacing.lg,
                        AppSpacing.navClearance + 56,
                      ),
                      itemCount: state.items.length + (state.hasMore ? 1 : 0),
                      separatorBuilder: (_, _) => AppSpacing.gapSm,
                      itemBuilder: (context, i) {
                        if (i >= state.items.length) {
                          return const Padding(
                            padding: EdgeInsets.all(AppSpacing.lg),
                            child: Center(child: CircularProgressIndicator()),
                          );
                        }
                        final row = state.items[i];
                        return ClientTile(
                          row: row,
                          onTap: () =>
                              context.push('${widget.basePath}/${row.id}'),
                        );
                      },
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// One client row: name, code · commune (or distance), balance.
class ClientTile extends StatelessWidget {
  const ClientTile({super.key, required this.row, required this.onTap});

  final ClientRow row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final subtitle = [
      row.code,
      if (row.distanceM != null)
        row.distanceM! >= 1000
            ? context.tr(
                'clients.distance_km',
                args: {'km': (row.distanceM! / 1000).toStringAsFixed(1)},
              )
            : context.tr('clients.distance_m', args: {'m': row.distanceM!})
      else if (row.commune != null && row.commune!.isNotEmpty)
        row.commune!,
    ].join(' · ');
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    row.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ],
              ),
            ),
            AppSpacing.gapSm,
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                AmountText(
                  row.balance,
                  colorBySign: true,
                  style: text.titleSmall,
                ),
                if (row.overLimit)
                  Text(
                    context.tr('clients.over_limit'),
                    style: text.labelSmall?.copyWith(color: AppColors.error),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
