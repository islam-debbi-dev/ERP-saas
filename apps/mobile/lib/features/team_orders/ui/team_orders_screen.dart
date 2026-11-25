import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/router/tab_badges.dart';
import '../../delivery/logic/delivery_groups.dart';
import '../../delivery/ui/deliveries_screen.dart';
import '../../orders/data/models/order.dart';
import '../data/team_orders_repository.dart';
import 'assign_sheet.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

/// "Commandes": the team's confirmed orders. *À assigner* (no livreur, no
/// truck) by default; *Assignées* to move one to another driver. Rows are
/// M2's, grouped by client. The count to assign goes on the tab's badge.
class TeamOrdersScreen extends StatefulWidget {
  const TeamOrdersScreen({super.key, required this.tabPath});

  final String tabPath;

  @override
  State<TeamOrdersScreen> createState() => _TeamOrdersScreenState();
}

class _TeamOrdersScreenState extends State<TeamOrdersScreen> {
  bool _assigned = false;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LoadCubit<TeamOrdersBoard>(
        () => getIt<TeamOrdersRepository>().board(),
      )..load(),
      child:
          BlocListener<LoadCubit<TeamOrdersBoard>, LoadState<TeamOrdersBoard>>(
            listenWhen: (_, s) => s.data != null && !s.loading,
            listener: (_, s) =>
                TabBadges.of(widget.tabPath).value = s.data!.toAssign.count,
            child: Scaffold(
              appBar: AppBar(title: Text(context.tr('team_orders.title'))),
              body:
                  BlocBuilder<
                    LoadCubit<TeamOrdersBoard>,
                    LoadState<TeamOrdersBoard>
                  >(
                    builder: (context, state) {
                      final cubit = context.read<LoadCubit<TeamOrdersBoard>>();
                      return LoadStateView<TeamOrdersBoard>(
                        state: state,
                        onRetry: cubit.load,
                        skeleton: const ListSkeleton(),
                        builder: (context, board) => Column(
                          children: [
                            Padding(
                              padding: const EdgeInsets.fromLTRB(
                                AppSpacing.lg,
                                AppSpacing.sm,
                                AppSpacing.lg,
                                AppSpacing.xs,
                              ),
                              child: Wrap(
                                spacing: AppSpacing.sm,
                                runSpacing: AppSpacing.xs,
                                children: [
                                  AppChoiceChip(
                                    label: context.tr(
                                      'team_orders.to_assign',
                                      args: {'count': board.toAssign.count},
                                    ),
                                    selected: !_assigned,
                                    onTap: () =>
                                        setState(() => _assigned = false),
                                  ),
                                  AppChoiceChip(
                                    label: context.tr(
                                      'team_orders.assigned',
                                      args: {'count': board.assigned.count},
                                    ),
                                    selected: _assigned,
                                    onTap: () =>
                                        setState(() => _assigned = true),
                                  ),
                                ],
                              ),
                            ),
                            Expanded(
                              child: RefreshIndicator(
                                onRefresh: cubit.load,
                                child: _OrdersList(
                                  board: _assigned
                                      ? board.assigned
                                      : board.toAssign,
                                  assigned: _assigned,
                                  onAssign: (order) => _assign(context, order),
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
            ),
          ),
    );
  }

  Future<void> _assign(BuildContext context, OrderSummary order) async {
    final cubit = context.read<LoadCubit<TeamOrdersBoard>>();
    final messenger = ScaffoldMessenger.of(context);
    final message = await showAssignSheet(context, order);
    if (message == null) return;
    messenger.showSnackBar(SnackBar(content: Text(message)));
    await cubit.load();
  }
}

class _OrdersList extends StatelessWidget {
  const _OrdersList({
    required this.board,
    required this.assigned,
    required this.onAssign,
  });

  final DeliveriesBoard board;
  final bool assigned;
  final void Function(OrderSummary order) onAssign;

  @override
  Widget build(BuildContext context) {
    if (board.isEmpty) {
      return ListView(
        padding: const EdgeInsets.only(top: AppSpacing.xxl),
        children: [
          AppEmptyState(
            icon: Icons.assignment_turned_in_outlined,
            title: context.tr(
              assigned
                  ? 'team_orders.empty_assigned'
                  : 'team_orders.empty_to_assign',
            ),
            message: assigned
                ? null
                : context.tr('team_orders.empty_to_assign_message'),
          ),
        ],
      );
    }
    return ListView(
      padding: EdgeInsetsDirectional.fromSTEB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        CustomBottomNavigation.listEnd(context),
      ),
      children: [
        for (final g in board.groups) ...[
          DeliveryGroupHeader(group: g, showStop: false),
          for (final o in g.orders) ...[
            DeliveryTile(
              order: o,
              detail: assigneeLabel(context, o),
              onTap: () => onAssign(o),
            ),
            AppSpacing.gapSm,
          ],
          AppSpacing.gapSm,
        ],
      ],
    );
  }
}

/// Who delivers an order: its truck (and that truck's driver), or a person.
/// Null when not assigned. Truck codes stay left to right in Arabic.
String? assigneeLabel(BuildContext context, OrderSummary o) {
  final truck = o.deliveryVehicle;
  if (truck != null) {
    return context.tr(
      o.livreur == null ? 'team_orders.on_truck_free' : 'team_orders.on_truck',
      args: {
        'truck': Money.ltr(truck.label),
        'name': o.livreur?.fullName ?? '',
      },
    );
  }
  if (o.livreur != null) {
    return context.tr(
      'team_orders.on_person',
      args: {'name': o.livreur!.fullName},
    );
  }
  return null;
}
