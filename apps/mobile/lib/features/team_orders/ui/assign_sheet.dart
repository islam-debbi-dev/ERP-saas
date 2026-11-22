import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../../orders/data/models/order.dart';
import '../../team/data/team_models.dart';
import '../data/team_orders_repository.dart';
import '../logic/assign_cubit.dart';
import 'team_orders_screen.dart' show assigneeLabel;

/// Opens the sheet; returns the confirmation text once the order is put on
/// someone, null when the supervisor closed it.
Future<String?> showAssignSheet(BuildContext context, OrderSummary order) =>
    showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => BlocProvider(
        create: (_) =>
            AssignCubit(getIt<TeamOrdersRepository>(), order: order)..load(),
        child: const AssignSheet(),
      ),
    );

/// Put a confirmed order on a delivery truck (whoever drives it delivers,
/// and it follows the truck when the driver changes) or on a deliverer of
/// the team.
class AssignSheet extends StatelessWidget {
  const AssignSheet({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return BlocBuilder<AssignCubit, AssignState>(
      builder: (context, state) {
        final cubit = context.read<AssignCubit>();
        final order = cubit.order;
        final current = assigneeLabel(context, order);
        final options = state.options;
        Future<void> done(Future<Order?> run, String message) async {
          final saved = await run;
          if (saved != null && context.mounted) {
            Navigator.of(context).pop(message);
          }
        }

        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.75,
          minChildSize: 0.4,
          maxChildSize: 0.95,
          builder: (context, scroll) => ListView(
            controller: scroll,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              0,
              AppSpacing.lg,
              AppSpacing.xl,
            ),
            children: [
              Text(
                context.tr('team_orders.assign_title'),
                style: text.titleMedium,
              ),
              const SizedBox(height: AppSpacing.xxs),
              Text(
                '${Money.ltr(order.number ?? '—')} · ${order.client.name}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: text.bodyMedium?.copyWith(color: context.textMuted),
              ),
              if (current != null) ...[
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  current,
                  style: text.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
              ],
              AppSpacing.gapMd,
              if (state.error != null) ...[
                FormErrorBanner(message: apiErrorText(context, state.error!)),
                AppSpacing.gapMd,
              ],
              if (options == null && state.loading)
                const Padding(
                  padding: EdgeInsets.all(AppSpacing.xl),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (options == null)
                AppErrorState(
                  title: context.tr('common.load_failed'),
                  message: state.loadError == null
                      ? null
                      : apiErrorText(context, state.loadError!),
                  retryLabel: context.tr('common.retry'),
                  onRetry: cubit.load,
                )
              else ...[
                AppSectionHeader(title: context.tr('team_orders.trucks')),
                if (options.trucks.isEmpty)
                  _Empty(context.tr('team_orders.no_trucks')),
                for (final t in options.trucks)
                  _OptionTile(
                    icon: Icons.local_shipping_outlined,
                    title: t.label,
                    ltrTitle: true,
                    subtitle: _truckSubtitle(context, t),
                    selected: order.deliveryVehicle?.id == t.id,
                    busy: state.busyId == t.id,
                    onTap:
                        state.busyId != null ||
                            order.deliveryVehicle?.id == t.id
                        ? null
                        : () => done(
                            cubit.toTruck(t.id),
                            context.tr(
                              'team_orders.done_truck',
                              args: {
                                'number': Money.ltr(order.number ?? '—'),
                                'truck': Money.ltr(t.label),
                              },
                            ),
                          ),
                  ),
                AppSpacing.gapLg,
                AppSectionHeader(title: context.tr('team_orders.people')),
                if (options.deliverers.isEmpty)
                  _Empty(context.tr('team_orders.no_people')),
                for (final d in options.deliverers)
                  _OptionTile(
                    icon: Icons.person_outline,
                    title: d.fullName,
                    subtitle: context.tr('roles.${d.role}'),
                    selected:
                        order.deliveryVehicle == null &&
                        order.livreur?.id == d.id,
                    busy: state.busyId == d.id,
                    onTap: state.busyId != null
                        ? null
                        : () => done(
                            cubit.toPerson(d.id),
                            context.tr(
                              'team_orders.done_person',
                              args: {
                                'number': Money.ltr(order.number ?? '—'),
                                'name': d.fullName,
                              },
                            ),
                          ),
                  ),
              ],
            ],
          ),
        );
      },
    );
  }

  static String _truckSubtitle(BuildContext context, TruckOption t) {
    final driver = t.driver == null
        ? context.tr('team.driver_free')
        : context.tr('team.driver_of', args: {'name': t.driver!.fullName});
    return t.isDelivery
        ? '${context.tr('team_orders.delivery_truck')} · $driver'
        : driver;
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
    child: Text(
      message,
      style: Theme.of(
        context,
      ).textTheme.bodyMedium?.copyWith(color: context.textMuted),
    ),
  );
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.busy,
    this.ltrTitle = false,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool selected;
  final bool busy;
  final bool ltrTitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: AppCard(
        onTap: onTap,
        padding: const EdgeInsets.all(AppSpacing.md),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
          child: Row(
            children: [
              Icon(icon, color: selected ? scheme.primary : context.textMuted),
              AppSpacing.gapMd,
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textDirection: ltrTitle ? TextDirection.ltr : null,
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
              if (busy)
                const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else if (selected)
                Icon(Icons.check_circle, color: scheme.primary),
            ],
          ),
        ),
      ),
    );
  }
}
