import 'package:flutter/material.dart';

import '../../../core/design/design.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../catalog/ui/product_picker_screen.dart' show stockText;
import '../data/transfer_models.dart';
import '../logic/transfer_form.dart';
import 'transfer_widgets.dart';

/// After *Valider* (or *Annuler*): the transfer as the server saved it, its
/// `TR-…` number, and in WARN mode the products a dépôt went below zero on.
class TransferResultView extends StatelessWidget {
  const TransferResultView({
    super.key,
    required this.result,
    required this.onDone,
    this.lines = const [],
  });

  final TransferResult result;
  final VoidCallback onDone;

  /// The form's lines, to name the products of the warnings.
  final List<TransferLineDraft> lines;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final t = result.transfer;
    final cancelled = t.isCancelled;
    final title = cancelled
        ? 'transfer.done_cancelled'
        : (t.isLoad ? 'transfer.done_load' : 'transfer.done_unload');
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) onDone();
      },
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: Text(context.tr(transferTypeKey(t.type))),
        ),
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            Icon(
              cancelled ? Icons.undo_rounded : Icons.check_circle_rounded,
              size: 64,
              color: cancelled ? AppColors.warning : AppColors.success,
            ),
            AppSpacing.gapSm,
            Text(
              context.tr(title),
              textAlign: TextAlign.center,
              style: text.titleLarge,
            ),
            if (t.number != null)
              Text(
                t.number!,
                textAlign: TextAlign.center,
                textDirection: TextDirection.ltr,
                style: text.titleMedium,
              ),
            AppSpacing.gapLg,
            if (result.warnings.isNotEmpty) ...[
              AppCard(
                color: AppColors.warning.withValues(alpha: 0.12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      context.tr('transfer.negative_title'),
                      style: text.titleSmall,
                    ),
                    for (final w in result.warnings)
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpacing.xs),
                        child: Text(
                          context.tr(
                            'transfer.negative_line',
                            args: {'name': _name(w.productId), 'qty': _qty(w)},
                          ),
                          style: text.bodyMedium,
                        ),
                      ),
                  ],
                ),
              ),
              AppSpacing.gapMd,
            ],
            TransferHeaderCard(transfer: t),
            AppSpacing.gapMd,
            TransferLinesCard(lines: t.lines),
          ],
        ),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.sm,
              AppSpacing.lg,
              AppSpacing.sm,
            ),
            child: AppButton(
              key: const Key('done'),
              label: context.tr('transfer.finish'),
              onPressed: onDone,
            ),
          ),
        ),
      ),
    );
  }

  String _name(String productId) {
    for (final l in lines) {
      if (l.productId == productId) return l.product.designation;
    }
    for (final l in result.transfer.lines) {
      if (l.productId == productId) return l.designation;
    }
    return productId;
  }

  String _qty(StockShortage w) {
    for (final l in lines) {
      if (l.productId == w.productId) return stockText(l.product, w.after);
    }
    return Qty.format(w.after);
  }
}
