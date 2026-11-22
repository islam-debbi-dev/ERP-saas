import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../data/team_models.dart';

/// *Pas ouverte / Ouverte / Clôturée* for a member's day.
class DayStatusChip extends StatelessWidget {
  const DayStatusChip({super.key, this.session});

  final SellerSession? session;

  @override
  Widget build(BuildContext context) {
    final s = session;
    final (key, color) = s == null
        ? ('team.status_none', AppColors.textTertiary)
        : s.isOpen
        ? ('team.status_open', AppColors.success)
        : ('team.status_closed', AppColors.info);
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
        maxLines: 1,
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

/// The colour of an écart: short in red, over in green, exact neutral.
Color ecartColor(BuildContext context, Decimal ecart) => ecart < Decimal.zero
    ? AppColors.error
    : ecart > Decimal.zero
    ? AppColors.success
    : context.textMain;

/// "Manque 1 200,00 DA", "Excédent 50,00 DA" or "Caisse juste".
String ecartLabel(BuildContext context, Decimal ecart) {
  if (ecart < Decimal.zero) {
    return context.tr(
      'team.ecart_short',
      args: {'amount': Money.format(-ecart)},
    );
  }
  if (ecart > Decimal.zero) {
    return context.tr('team.ecart_over', args: {'amount': Money.format(ecart)});
  }
  return context.tr('team.ecart_zero');
}

/// A label and its amount on one line; the label wraps, the amount stays.
class AmountRow extends StatelessWidget {
  const AmountRow({
    super.key,
    required this.label,
    required this.value,
    this.style,
    this.valueStyle,
  });

  final String label;
  final Decimal value;
  final TextStyle? style;
  final TextStyle? valueStyle;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style ?? text.bodyMedium)),
          AppSpacing.gapSm,
          AmountText(value, style: valueStyle ?? style ?? text.bodyMedium),
        ],
      ),
    );
  }
}

/// One member on the Équipe tab: truck, cash expected (sales and
/// versements), the state of his day and the écart once closed.
class SellerDayCard extends StatelessWidget {
  const SellerDayCard({super.key, required this.day, this.onTap});

  final SellerDay day;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final s = day.session;
    final expected = s != null && !s.isOpen ? s.expected : day.expected;
    final ecart = s?.currentEcart;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  day.seller.fullName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall,
                ),
              ),
              AppSpacing.gapSm,
              DayStatusChip(session: s),
            ],
          ),
          const SizedBox(height: AppSpacing.xxs),
          Row(
            children: [
              Icon(
                Icons.local_shipping_outlined,
                size: 16,
                color: context.textMuted,
              ),
              const SizedBox(width: AppSpacing.xs),
              Flexible(
                child: day.vehicle == null
                    ? Text(
                        context.tr('team.no_truck'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall?.copyWith(
                          color: context.textMuted,
                        ),
                      )
                    : Text(
                        Money.ltr(day.vehicle!.name),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall?.copyWith(
                          color: context.textMuted,
                        ),
                      ),
              ),
            ],
          ),
          AppSpacing.gapSm,
          AmountRow(
            label: context.tr('team.cash_sales'),
            value: expected.fromSales,
            style: text.bodySmall,
          ),
          AmountRow(
            label: context.tr('team.cash_versements'),
            value: expected.fromVersements,
            style: text.bodySmall,
          ),
          AmountRow(
            label: context.tr('team.expected'),
            value: expected.total,
            style: text.titleSmall,
          ),
          if (ecart != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xxs),
              child: Text(
                ecartLabel(context, ecart),
                maxLines: 2,
                style: text.bodySmall?.copyWith(
                  color: ecartColor(context, ecart),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
