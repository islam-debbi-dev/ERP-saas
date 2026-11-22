import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../sales/ui/sale_screen.dart' show MoneyErrorCard;
import '../data/team_models.dart';
import '../data/team_repository.dart';
import '../logic/team_cubits.dart';
import 'cash_form_screen.dart';
import 'driver_screen.dart';
import 'team_widgets.dart';

/// One member's day: expected cash, sales, truck, and the supervisor's
/// actions (open, close with the cash handed, correct, change the truck).
///
/// The member is looked up in the team list the API returns for [date]: an
/// id that is not in it (another supervisor's seller, a typed link) shows
/// "not in your team" and nothing is read with that id.
class MemberDayScreen extends StatelessWidget {
  const MemberDayScreen({
    super.key,
    required this.sellerId,
    required this.date,
    this.today,
  });

  final String sellerId;
  final String date;

  /// Today's Algiers day (tests pin it); the truck changes only today.
  final String? today;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => MemberDayCubit(
        getIt<TeamRepository>(),
        sellerId: sellerId,
        date: date,
      )..load(),
      child: _MemberDayView(isToday: date == (today ?? AlgiersDay.of())),
    );
  }
}

class _MemberDayView extends StatelessWidget {
  const _MemberDayView({required this.isToday});

  final bool isToday;

  Future<void> _openForm(
    BuildContext context,
    SellerDay day,
    CashFormMode mode,
  ) async {
    final cubit = context.read<MemberDayCubit>();
    await Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute<void>(
        builder: (_) => CashFormScreen(member: day, mode: mode),
      ),
    );
    await cubit.load();
  }

  Future<void> _openDriver(BuildContext context, SellerDay day) async {
    final cubit = context.read<MemberDayCubit>();
    await Navigator.of(
      context,
      rootNavigator: true,
    ).push(MaterialPageRoute<void>(builder: (_) => DriverScreen(member: day)));
    await cubit.load();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<MemberDayCubit, MemberDayState>(
      builder: (context, state) {
        final cubit = context.read<MemberDayCubit>();
        final data = state.data;
        final day = data?.day;
        Widget body;
        if (data == null && state.loading) {
          body = const AppLoader();
        } else if (data == null) {
          body = AppErrorState(
            title: context.tr('common.load_failed'),
            message: state.loadError == null
                ? null
                : apiErrorText(context, state.loadError!),
            retryLabel: context.tr('common.retry'),
            onRetry: cubit.load,
          );
        } else if (day == null) {
          body = ListView(
            padding: const EdgeInsets.only(top: AppSpacing.xxl),
            children: [
              AppEmptyState(
                icon: Icons.person_off_outlined,
                title: context.tr('team.not_in_team_title'),
                message: context.tr('team.not_in_team_message'),
              ),
            ],
          );
        } else {
          body = RefreshIndicator(
            onRefresh: cubit.load,
            child: _DayBody(
              data: data,
              day: day,
              isToday: isToday,
              onChangeTruck: isToday ? () => _openDriver(context, day) : null,
            ),
          );
        }
        final s = day?.session;
        final Widget? action = day == null
            ? null
            : s == null
            ? AppButton(
                label: context.tr('team.open_day'),
                icon: Icons.play_circle_outline,
                loading: state.opening,
                onPressed: cubit.openDay,
              )
            : s.isOpen
            ? AppButton(
                label: context.tr('team.close_day'),
                icon: Icons.lock_clock_outlined,
                onPressed: () => _openForm(context, day, CashFormMode.close),
              )
            : AppButton(
                label: context.tr('team.adjust'),
                icon: Icons.edit_note_outlined,
                variant: AppButtonVariant.secondary,
                onPressed: () => _openForm(context, day, CashFormMode.adjust),
              );
        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  day?.seller.fullName ?? context.tr('team.title'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  AlgiersDay.display(cubit.date),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          bottomNavigationBar: action == null
              ? null
              : SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (state.error != null) ...[
                          MoneyErrorCard(error: state.error!),
                          AppSpacing.gapSm,
                        ],
                        action,
                      ],
                    ),
                  ),
                ),
          body: body,
        );
      },
    );
  }
}

class _DayBody extends StatelessWidget {
  const _DayBody({
    required this.data,
    required this.day,
    required this.isToday,
    this.onChangeTruck,
  });

  final MemberDay data;
  final SellerDay day;
  final bool isToday;
  final VoidCallback? onChangeTruck;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final s = day.session;
    final closed = s != null && !s.isOpen;
    final expected = closed ? s.expected : day.expected;
    final handed = s?.currentHanded;
    final ecart = s?.currentEcart;
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      context.tr('team.expected'),
                      style: text.labelLarge?.copyWith(
                        color: context.textMuted,
                      ),
                    ),
                  ),
                  DayStatusChip(session: s),
                ],
              ),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: AlignmentDirectional.centerStart,
                child: AmountText(expected.total, style: text.headlineMedium),
              ),
              AppSpacing.gapSm,
              AmountRow(
                label: context.tr('team.cash_sales'),
                value: expected.fromSales,
              ),
              AmountRow(
                label: context.tr('team.cash_versements'),
                value: expected.fromVersements,
              ),
              if (closed) ...[
                const Divider(),
                if (handed != null)
                  AmountRow(label: context.tr('team.handed'), value: handed),
                if (ecart != null) ...[
                  AmountRow(
                    label: context.tr('team.ecart'),
                    value: ecart,
                    valueStyle: text.titleSmall?.copyWith(
                      color: ecartColor(context, ecart),
                    ),
                  ),
                  Text(
                    ecartLabel(context, ecart),
                    style: text.bodySmall?.copyWith(
                      color: ecartColor(context, ecart),
                    ),
                  ),
                ],
                if (s.closedBy != null && s.closedAt != null)
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.xs),
                    child: Text(
                      context.tr(
                        'team.closed_by',
                        args: {
                          'name': s.closedBy!.fullName,
                          'time': AlgiersDay.displayDateTime(s.closedAt!),
                        },
                      ),
                      style: text.bodySmall?.copyWith(color: context.textMuted),
                    ),
                  ),
              ],
              AppSpacing.gapXs,
              Text(
                context.tr('truck.cash_note'),
                style: AppTextStyles.caption.copyWith(color: context.textMuted),
              ),
            ],
          ),
        ),
        AppSpacing.gapMd,
        AppCard(
          child: data.sales == null
              ? Text(
                  context.tr('team.sales_unavailable'),
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                )
              : Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            context.tr('team.sales'),
                            style: text.labelLarge?.copyWith(
                              color: context.textMuted,
                            ),
                          ),
                          Text(
                            context.tr(
                              'team.sales_count',
                              args: {'count': data.sales!.count},
                            ),
                            style: text.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    AppSpacing.gapSm,
                    AmountText(data.sales!.netTtc, style: text.titleMedium),
                  ],
                ),
        ),
        AppSpacing.gapMd,
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                context.tr('team.truck'),
                style: text.labelLarge?.copyWith(color: context.textMuted),
              ),
              AppSpacing.gapXs,
              Row(
                children: [
                  Icon(Icons.local_shipping_outlined, color: context.textMuted),
                  AppSpacing.gapSm,
                  Expanded(
                    child: Text(
                      day.vehicle == null
                          ? context.tr('team.no_truck')
                          : Money.ltr(day.vehicle!.name),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleSmall,
                    ),
                  ),
                ],
              ),
              if (onChangeTruck != null) ...[
                AppSpacing.gapSm,
                AppButton(
                  label: context.tr(
                    day.vehicle == null
                        ? 'team.give_truck'
                        : 'team.change_truck',
                  ),
                  icon: Icons.swap_horiz_rounded,
                  variant: AppButtonVariant.secondary,
                  onPressed: onChangeTruck,
                ),
              ],
            ],
          ),
        ),
        if (s != null && s.adjustments.isNotEmpty) ...[
          AppSpacing.gapLg,
          AppSectionHeader(title: context.tr('team.adjustments')),
          for (final a in s.adjustments) ...[
            AppCard(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    context.tr(
                      'team.adjustment_by',
                      args: {
                        'name': a.by?.fullName ?? '—',
                        'time': AlgiersDay.displayDateTime(a.at),
                      },
                    ),
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                  if (a.handedCash != null)
                    AmountRow(
                      label: context.tr('team.handed'),
                      value: a.handedCash!,
                    ),
                  if (a.ecart != null)
                    AmountRow(
                      label: context.tr('team.ecart'),
                      value: a.ecart!,
                      valueStyle: text.bodyMedium?.copyWith(
                        color: ecartColor(context, a.ecart!),
                      ),
                    ),
                  if (a.note != null) Text(a.note!, style: text.bodyMedium),
                ],
              ),
            ),
            AppSpacing.gapSm,
          ],
        ],
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }
}
