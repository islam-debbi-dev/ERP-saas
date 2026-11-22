import 'package:flutter/material.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/share/pdf_share.dart';
import '../data/models/payment.dart';

/// A versement as the API saved it, with "Partager reçu" (the API's PDF).
class ReceiptView extends StatefulWidget {
  const ReceiptView({super.key, required this.payment, this.onDone});

  final Payment payment;
  final VoidCallback? onDone;

  @override
  State<ReceiptView> createState() => _ReceiptViewState();
}

class _ReceiptViewState extends State<ReceiptView> {
  bool _sharing = false;

  Future<void> _share() async {
    setState(() => _sharing = true);
    await sharePdf(
      context,
      path: '/payments/${widget.payment.id}/receipt.pdf',
      fileName: pdfName(widget.payment.number, 'recu'),
    );
    if (mounted) setState(() => _sharing = false);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final p = widget.payment;
    final geo = p.geoStatus;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: widget.onDone == null,
        title: Text(context.tr('versement.saved_title')),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: AppButton(
                  label: context.tr('versement.share_receipt'),
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
                    const Icon(Icons.check_circle, color: AppColors.success),
                    AppSpacing.gapSm,
                    Expanded(
                      child: Text(
                        p.number,
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.start,
                        style: text.titleLarge,
                      ),
                    ),
                  ],
                ),
                AppSpacing.gapSm,
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: AlignmentDirectional.centerStart,
                  child: AmountText(p.amount, style: text.headlineMedium),
                ),
                AppSpacing.gapXs,
                Text(
                  [
                    if (p.client != null) p.client!.name,
                    context.tr('payment.mode_${p.mode}'),
                    AlgiersDay.displayDateTime(p.receivedAt),
                  ].join(' · '),
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                ),
                if (p.reference != null && p.reference!.isNotEmpty)
                  Text(
                    [
                      p.reference!,
                      if (p.bank != null) p.bank!,
                      if (p.dueDate != null) AlgiersDay.display(p.dueDate!),
                    ].join(' · '),
                    style: text.bodySmall,
                  ),
              ],
            ),
          ),
          if (p.allocations.isNotEmpty) ...[
            AppSpacing.gapLg,
            AppSectionHeader(title: context.tr('versement.allocations')),
            for (final a in p.allocations)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        a.saleNumber ?? a.saleType,
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.start,
                      ),
                    ),
                    AmountText(a.amount, style: text.titleSmall),
                  ],
                ),
              ),
          ],
          if (geo != null && geo != 'OK') ...[
            AppSpacing.gapMd,
            Row(
              children: [
                const Icon(
                  Icons.location_off_outlined,
                  color: AppColors.warning,
                ),
                AppSpacing.gapSm,
                Expanded(child: Text(context.tr('geo.status_$geo'))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
