import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../sales/ui/sale_screen.dart' show MoneyErrorCard;
import '../data/team_models.dart';
import '../data/team_repository.dart';
import '../logic/team_cubits.dart';

/// "Qui conduit aujourd'hui ?": the member takes one of the trucks in the
/// supervisor's reach. The API refuses while his day (or the leaving
/// driver's) is open, or with cash collected after the clôture: the refusal
/// is shown as it comes. Pops with a confirmation text on success.
class DriverScreen extends StatelessWidget {
  const DriverScreen({super.key, required this.member});

  final SellerDay member;

  @override
  Widget build(BuildContext context) => BlocProvider(
    create: (_) => DriverCubit(getIt<TeamRepository>(), member: member)..load(),
    child: const _DriverView(),
  );
}

class _DriverView extends StatelessWidget {
  const _DriverView();

  Future<void> _pick(BuildContext context, TruckOption truck) async {
    final cubit = context.read<DriverCubit>();
    final member = cubit.member;
    final name = member.seller.fullName;
    final warnings = [
      if (truck.driver != null && truck.driver!.id != member.seller.id)
        context.tr(
          'team.driver_warn_takes',
          args: {
            'driver': truck.driver!.fullName,
            'truck': Money.ltr(truck.label),
          },
        ),
      if (member.vehicle != null && member.vehicle!.id != truck.id)
        context.tr(
          'team.driver_warn_leaves',
          args: {'truck': Money.ltr(member.vehicle!.name)},
        ),
    ];
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          context.tr(
            'team.driver_confirm_title',
            args: {'name': name, 'truck': Money.ltr(truck.label)},
          ),
        ),
        content: warnings.isEmpty ? null : Text(warnings.join('\n')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.tr('common.confirm')),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final done = await cubit.assign(truck);
    if (done != null && context.mounted) {
      final messenger = ScaffoldMessenger.of(context);
      final message = context.tr(
        'team.driver_done',
        args: {'name': name, 'truck': Money.ltr(truck.label)},
      );
      Navigator.of(context).pop();
      messenger.showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<DriverCubit, DriverState>(
      builder: (context, state) {
        final cubit = context.read<DriverCubit>();
        final text = Theme.of(context).textTheme;
        final trucks = state.trucks;
        Widget body;
        if (trucks == null && state.loading) {
          body = const ListSkeleton();
        } else if (trucks == null) {
          body = AppErrorState(
            title: context.tr('common.load_failed'),
            message: state.loadError == null
                ? null
                : apiErrorText(context, state.loadError!),
            retryLabel: context.tr('common.retry'),
            onRetry: cubit.load,
          );
        } else if (trucks.isEmpty) {
          body = ListView(
            padding: const EdgeInsets.only(top: AppSpacing.xxl),
            children: [
              AppEmptyState(
                icon: Icons.local_shipping_outlined,
                title: context.tr('team.driver_no_trucks'),
              ),
            ],
          );
        } else {
          body = ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: [
              if (state.error != null) ...[
                MoneyErrorCard(error: state.error!),
                AppSpacing.gapMd,
              ],
              for (final t in trucks) ...[
                _TruckTile(
                  truck: t,
                  isCurrent: t.id == cubit.member.vehicle?.id,
                  busy: state.submittingTruckId == t.id,
                  onTap:
                      state.submittingTruckId != null ||
                          t.id == cubit.member.vehicle?.id
                      ? null
                      : () => _pick(context, t),
                ),
                AppSpacing.gapSm,
              ],
            ],
          );
        }
        return Scaffold(
          appBar: AppBar(
            title: Text(
              context.tr(
                'team.driver_title',
                args: {'name': cubit.member.seller.fullName},
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: text.titleMedium,
            ),
          ),
          body: body,
        );
      },
    );
  }
}

class _TruckTile extends StatelessWidget {
  const _TruckTile({
    required this.truck,
    required this.isCurrent,
    required this.busy,
    this.onTap,
  });

  final TruckOption truck;
  final bool isCurrent;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final driver = truck.driver;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
        child: Row(
          children: [
            Icon(
              Icons.local_shipping_outlined,
              color: isCurrent ? scheme.primary : context.textMuted,
            ),
            AppSpacing.gapMd,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    truck.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: TextDirection.ltr,
                    style: text.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    isCurrent
                        ? context.tr('team.driver_current')
                        : driver == null
                        ? context.tr('team.driver_free')
                        : context.tr(
                            'team.driver_of',
                            args: {'name': driver.fullName},
                          ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(
                      color: isCurrent ? scheme.primary : context.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            if (busy)
              const SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
      ),
    );
  }
}
