import 'package:flutter/material.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/share/pdf_share.dart';
import '../../sales/ui/widgets/basket_summary.dart';
import '../../sales/ui/widgets/doc_status_chip.dart';
import '../data/models/order.dart';

/// A bon de commande as the API saved it: number, status, lines, totals, and
/// the bon de commande PDF. [actions] adds buttons (cancel a draft...).
class OrderResultView extends StatefulWidget {
  const OrderResultView({
    super.key,
    required this.order,
    this.onDone,
    this.actions = const [],
  });

  final Order order;
  final VoidCallback? onDone;
  final List<Widget> actions;

  @override
  State<OrderResultView> createState() => _OrderResultViewState();
}

class _OrderResultViewState extends State<OrderResultView> {
  bool _sharing = false;

  Future<void> _share() async {
    setState(() => _sharing = true);
    await sharePdf(
      context,
      path: '/documents/BC/${widget.order.id}/pdf',
      fileName: pdfName(widget.order.number, 'BC'),
    );
    if (mounted) setState(() => _sharing = false);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final o = widget.order;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: widget.onDone == null,
        title: Text(context.tr('order.title')),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: AppButton(
                  label: context.tr('common.share_pdf'),
                  icon: Icons.picture_as_pdf_outlined,
                  variant: AppButtonVariant.outline,
                  loading: _sharing,
                  onPressed: _share,
                ),
              ),
              if (widget.onDone != null) ...[
                AppSpacing.gapMd,
                Expanded(
                  child: AppButton(
                    label: context.tr('sale.done'),
                    onPressed: widget.onDone,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      body: ListView(
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
                        o.number ?? context.tr('order.no_number'),
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.start,
                        style: text.titleLarge,
                      ),
                    ),
                    DocStatusChip(status: o.status),
                  ],
                ),
                AppSpacing.gapSm,
                Text(
                  [
                    o.client.name,
                    if (o.requestedDate != null)
                      context.tr(
                        'order.for_date',
                        args: {'date': AlgiersDay.display(o.requestedDate!)},
                      ),
                  ].join(' · '),
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                ),
                if (o.cancelReason != null) ...[
                  AppSpacing.gapSm,
                  Text(
                    o.cancelReason!,
                    style: text.bodySmall?.copyWith(color: AppColors.error),
                  ),
                ],
              ],
            ),
          ),
          AppSpacing.gapMd,
          for (final l in o.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l.designation, style: text.titleSmall),
                        Text(
                          l.isFree
                              ? context.tr(
                                  'sale.free_qty',
                                  args: {
                                    'qty': Qty.withUnit(l.qty, l.unitCode),
                                  },
                                )
                              : Money.ltr(
                                  '${Qty.format(l.qty, isolate: false)} ${l.unitCode} × ${Money.format(l.unitPriceHt, isolate: false)}',
                                ),
                          style: text.bodySmall?.copyWith(
                            color: l.isFree
                                ? AppColors.success
                                : context.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  AmountText(l.lineHt, style: text.titleSmall),
                ],
              ),
            ),
          AppSpacing.gapMd,
          BasketSummary(
            totalHt: o.totalHt,
            totalTva: o.totalTva,
            totalTtc: o.totalTtc,
            estimated: false,
          ),
          ...widget.actions,
        ],
      ),
    );
  }
}
