import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../../../core/components/widgets/amount_text.dart';
import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';

/// Totals block of a basket or a saved document (adapted from the consumer
/// cart's order summary): HT, TVA, TTC, paid and what stays on credit.
/// [estimated] marks the phone's preview; a saved document passes false.
class BasketSummary extends StatelessWidget {
  const BasketSummary({
    super.key,
    required this.totalHt,
    required this.totalTva,
    required this.totalTtc,
    this.timbre,
    this.paid,
    this.credit,
    this.change,
    this.estimated = true,
  });

  final Decimal totalHt;
  final Decimal totalTva;
  final Decimal totalTtc;
  final Decimal? timbre;
  final Decimal? paid;
  final Decimal? credit;
  final Decimal? change;
  final bool estimated;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        children: [
          _row(context, 'sale.total_ht', totalHt),
          _row(context, 'sale.total_tva', totalTva),
          if (timbre != null && timbre! > Decimal.zero)
            _row(context, 'sale.timbre', timbre!),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Divider(height: 1, color: context.fieldBorder),
          ),
          _row(context, 'sale.total_ttc', totalTtc, bold: true),
          if (paid != null) _row(context, 'sale.paid', paid!),
          if (credit != null && credit! > Decimal.zero)
            _row(context, 'sale.on_credit', credit!, danger: true),
          if (change != null && change! > Decimal.zero)
            _row(context, 'sale.change', change!),
          if (estimated) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              context.tr('sale.estimate_note'),
              style: AppTextStyles.caption.copyWith(color: context.textMuted),
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(
    BuildContext context,
    String key,
    Decimal value, {
    bool bold = false,
    bool danger = false,
  }) {
    final style = (bold ? AppTextStyles.h2 : AppTextStyles.body).copyWith(
      color: bold ? context.textMain : context.textMuted,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          Expanded(child: Text(context.tr(key), style: style)),
          AmountText(
            value,
            style: style.copyWith(
              color: danger ? AppColors.error : context.textMain,
            ),
          ),
        ],
      ),
    );
  }
}
