import 'package:flutter/material.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/share/pdf_share.dart';
import '../data/models/sale.dart';
import 'widgets/basket_summary.dart';
import 'widgets/doc_status_chip.dart';

/// The BL as the API saved it (never the phone's preview), with
/// "Partager PDF". Also used to open a past sale.
class SaleResultView extends StatefulWidget {
  const SaleResultView({
    super.key,
    required this.result,
    this.onDone,
    this.justSaved = true,
  });

  final SaleResult result;

  /// False when opening a past sale (no "saved" title, no check mark).
  final bool justSaved;

  /// "Terminé": back to where the sale started.
  final VoidCallback? onDone;

  @override
  State<SaleResultView> createState() => _SaleResultViewState();
}

class _SaleResultViewState extends State<SaleResultView> {
  bool _sharing = false;

  Future<void> _share() async {
    final sale = widget.result.sale;
    setState(() => _sharing = true);
    await sharePdf(
      context,
      path:
          '/documents/${sale.type == 'FACTURE' ? 'FAC' : 'BL'}/${sale.id}/pdf',
      fileName: pdfName(sale.number, 'BL'),
    );
    if (mounted) setState(() => _sharing = false);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final r = widget.result;
    final sale = r.sale;
    final geo = r.geoStatus;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: widget.onDone == null,
        title: Text(
          context.tr(widget.justSaved ? 'sale.saved_title' : 'sale.document'),
        ),
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
                    if (widget.justSaved) ...[
                      const Icon(Icons.check_circle, color: AppColors.success),
                      AppSpacing.gapSm,
                    ],
                    Expanded(
                      child: Text(
                        sale.number ?? '—',
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.start,
                        style: text.titleLarge,
                      ),
                    ),
                    DocStatusChip(status: sale.status),
                  ],
                ),
                AppSpacing.gapSm,
                Text(
                  [
                    sale.client?.name ?? context.tr('sale.counter'),
                    AlgiersDay.display(sale.documentDate),
                  ].join(' · '),
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                ),
              ],
            ),
          ),
          AppSpacing.gapMd,
          for (final l in sale.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
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
                                    'qty': Qty.format(l.qty),
                                    'unit': l.unitLabel,
                                  },
                                )
                              : '${Qty.format(l.qty)} ${l.unitLabel} × ${Money.format(l.unitPriceHt)}',
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
            totalHt: sale.totalHt,
            totalTva: sale.totalTva,
            totalTtc: sale.totalTtc,
            timbre: sale.timbre,
            paid: sale.paidAmount,
            credit: sale.remaining,
            change: r.change,
            estimated: false,
          ),
          if (geo != null && geo != 'OK') ...[
            AppSpacing.gapMd,
            Row(
              children: [
                const Icon(
                  Icons.location_off_outlined,
                  color: AppColors.warning,
                ),
                AppSpacing.gapSm,
                Expanded(
                  child: Text(
                    context.tr('geo.status_$geo'),
                    style: text.bodySmall,
                  ),
                ),
              ],
            ),
          ],
          for (final w in r.warnings)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Text(
                context.tr('sale.warning_${w['kind']}'),
                style: text.bodySmall?.copyWith(color: AppColors.warning),
              ),
            ),
        ],
      ),
    );
  }
}
