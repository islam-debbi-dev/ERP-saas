import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/me_day.dart';
import '../data/truck_repository.dart';

/// "Mon camion" (vendeur, livreur): the truck, the day's session, the cash
/// to hand over, what is on the truck and today's chargements /
/// déchargements, read only. Quantities only, never a cost.
class TruckScreen extends StatelessWidget {
  const TruckScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    final hasTournees = user?.hasFeature(Feature.tournees) ?? false;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('truck.title'))),
      body: !hasTournees
          ? AppEmptyState(
              icon: Icons.local_shipping_outlined,
              title: context.tr('today.no_tournees_title'),
              message: context.tr('truck.no_tournees'),
            )
          : BlocProvider(
              create: (_) =>
                  LoadCubit<MeDay>(getIt<TruckRepository>().myDay)..load(),
              child: BlocBuilder<LoadCubit<MeDay>, LoadState<MeDay>>(
                builder: (context, state) => LoadStateView<MeDay>(
                  state: state,
                  onRetry: context.read<LoadCubit<MeDay>>().load,
                  skeleton: const ListSkeleton(rows: 5, rowHeight: 88),
                  builder: (context, day) => RefreshIndicator(
                    onRefresh: context.read<LoadCubit<MeDay>>().load,
                    child: _TruckBody(day: day),
                  ),
                ),
              ),
            ),
    );
  }
}

class _TruckBody extends StatelessWidget {
  const _TruckBody({required this.day});

  final MeDay day;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final user = context.watch<SessionCubit>().state.user;
    final canTransfer = user?.can(Permission.stockTransfer) ?? false;
    final vehicle = day.vehicle;
    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.navClearance,
      ),
      children: [
        AppCard(
          child: Row(
            children: [
              Icon(
                Icons.local_shipping_outlined,
                size: 32,
                color: vehicle == null
                    ? context.textFaint
                    : Theme.of(context).colorScheme.primary,
              ),
              AppSpacing.gapMd,
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      vehicle?.label ?? context.tr('today.no_truck'),
                      style: text.titleMedium,
                    ),
                    Text(
                      AlgiersDay.display(day.day),
                      style: text.bodySmall?.copyWith(color: context.textMuted),
                    ),
                  ],
                ),
              ),
              _SessionChip(session: day.session),
            ],
          ),
        ),
        AppSpacing.gapMd,
        _CashCard(day: day),
        AppSpacing.gapXl,
        AppSectionHeader(title: context.tr('truck.stock')),
        AppSpacing.gapSm,
        if (vehicle == null)
          Text(
            context.tr('truck.no_truck_stock'),
            style: text.bodyMedium?.copyWith(color: context.textMuted),
          )
        else if (day.stock.isEmpty)
          Text(
            context.tr('truck.empty'),
            style: text.bodyMedium?.copyWith(color: context.textMuted),
          )
        else
          AppCard(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            child: Column(
              children: [
                for (final l in day.stock)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.xs,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            l.designation,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodyMedium,
                          ),
                        ),
                        AppSpacing.gapSm,
                        Text(
                          Qty.withUnit(l.qtyBase, l.unitCode),
                          style: text.titleSmall,
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        AppSpacing.gapXl,
        AppSectionHeader(title: context.tr('truck.transfers')),
        AppSpacing.gapSm,
        if (day.transfers.isEmpty)
          Text(
            context.tr('truck.no_transfers'),
            style: text.bodyMedium?.copyWith(color: context.textMuted),
          )
        else
          for (final tr in day.transfers) ...[
            _TransferTile(transfer: tr),
            AppSpacing.gapSm,
          ],
        if (canTransfer) ...[
          AppSpacing.gapMd,
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(AppSpacing.minTouch),
            ),
            // The chargement form comes with the magasinier screens (M3b).
            onPressed: null,
            icon: const Icon(Icons.move_to_inbox_outlined),
            label: Text(context.tr('truck.new_load_soon')),
          ),
        ],
      ],
    );
  }
}

class _SessionChip extends StatelessWidget {
  const _SessionChip({this.session});

  final DaySession? session;

  @override
  Widget build(BuildContext context) {
    final s = session;
    final (key, color) = s == null
        ? ('truck.session_none', AppColors.textTertiary)
        : s.isOpen
        ? ('truck.session_open', AppColors.success)
        : ('truck.session_closed', AppColors.info);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm + 2,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: AppRadius.pillAll,
      ),
      child: Text(
        context.tr(key),
        style: AppTextStyles.caption.copyWith(
          color: context.isDarkMode
              ? color
              : Color.lerp(color, AppColors.ink, 0.35),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// The cash the user must hand over (espèces only), and the écart once the
/// day is closed.
class _CashCard extends StatelessWidget {
  const _CashCard({required this.day});

  final MeDay day;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final s = day.session;
    Widget row(String key, Widget value, {TextStyle? style}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        children: [
          Expanded(
            child: Text(context.tr(key), style: style ?? text.bodyMedium),
          ),
          value,
        ],
      ),
    );
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            context.tr('truck.expected_cash'),
            style: text.labelLarge?.copyWith(color: context.textMuted),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: AmountText(day.expected.total, style: text.headlineMedium),
          ),
          AppSpacing.gapSm,
          row(
            'truck.from_sales',
            AmountText(day.expected.fromSales, style: text.bodyMedium),
          ),
          row(
            'truck.from_versements',
            AmountText(day.expected.fromVersements, style: text.bodyMedium),
          ),
          if (s != null && !s.isOpen) ...[
            const Divider(),
            if (s.handedCash != null)
              row(
                'truck.handed',
                AmountText(s.handedCash!, style: text.bodyMedium),
              ),
            if (s.ecart != null)
              row(
                'truck.ecart',
                AmountText(
                  s.ecart!,
                  style: text.titleSmall?.copyWith(
                    color: s.ecart! < Decimal.zero
                        ? AppColors.error
                        : context.textMain,
                  ),
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
    );
  }
}

class _TransferTile extends StatelessWidget {
  const _TransferTile({required this.transfer});

  final DayTransfer transfer;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final t = transfer;
    return AppCard(
      padding: EdgeInsets.zero,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Icon(
            t.isLoad ? Icons.move_to_inbox_outlined : Icons.outbox_outlined,
            color: t.isLoad ? AppColors.success : AppColors.info,
          ),
          title: Text(
            context.tr(t.isLoad ? 'truck.load' : 'truck.unload'),
            style: text.titleSmall,
          ),
          subtitle: Text(
            [
              t.number ?? '—',
              AlgiersDay.time(t.validatedAt),
              context.tr('truck.line_count', args: {'n': t.lines.length}),
            ].join(' · '),
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            0,
            AppSpacing.lg,
            AppSpacing.md,
          ),
          children: [
            for (final l in t.lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(l.designation, style: text.bodyMedium),
                    ),
                    Text(
                      Qty.withUnit(l.qty, l.unitCode),
                      style: text.titleSmall,
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
