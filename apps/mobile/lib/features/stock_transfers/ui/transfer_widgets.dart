import 'package:flutter/material.dart';

import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../data/transfer_models.dart';

/// Brouillon / Validé / Annulé.
class TransferStatusChip extends StatelessWidget {
  const TransferStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (key, color) = switch (status) {
      TransferStatus.draft => ('transfer.status_draft', AppColors.warning),
      TransferStatus.cancelled => (
        'transfer.status_cancelled',
        AppColors.error,
      ),
      _ => ('transfer.status_validated', AppColors.success),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xxs,
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
              : Color.lerp(color, AppColors.ink, 0.4),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Chargement (dépôt → camion) or déchargement (camion → dépôt).
IconData transferIcon(String type) => type == TransferType.load
    ? Icons.move_to_inbox_outlined
    : Icons.outbox_outlined;

String transferTypeKey(String type) =>
    type == TransferType.load ? 'truck.load' : 'truck.unload';

/// A row of the Chargements list: kind, number (or Brouillon), from → to,
/// line count and time. Quantities and money never show here.
class TransferTile extends StatelessWidget {
  const TransferTile({super.key, required this.transfer, this.onTap});

  final TransferSummary transfer;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final t = transfer;
    final when = t.validatedAt ?? t.createdAt;
    final today = AlgiersDay.of(when) == AlgiersDay.of();
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Icon(
            transferIcon(t.type),
            color: t.isCancelled
                ? context.textMuted
                : (t.isLoad ? AppColors.success : AppColors.info),
          ),
          AppSpacing.gapMd,
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        context.tr(transferTypeKey(t.type)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.titleSmall,
                      ),
                    ),
                    AppSpacing.gapSm,
                    TransferStatusChip(status: t.status),
                  ],
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  '${t.from.name} → ${t.to.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodyMedium,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  [
                    if (t.number != null) Money.ltr(t.number!),
                    today
                        ? AlgiersDay.time(when)
                        : AlgiersDay.displayDateTime(when),
                    context.tr('truck.line_count', args: {'n': t.lineCount}),
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(color: context.textMuted),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right_rounded, color: context.textMuted),
        ],
      ),
    );
  }
}

/// The head of a transfer: kind, status, number, from → to, who and when,
/// the note and the cancel reason.
class TransferHeaderCard extends StatelessWidget {
  const TransferHeaderCard({super.key, required this.transfer});

  final StockTransfer transfer;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final t = transfer;
    Widget info(String key, String value) => Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Text(
        '${context.tr(key)} : $value',
        style: text.bodySmall?.copyWith(color: context.textMuted),
      ),
    );
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                transferIcon(t.type),
                color: t.isLoad ? AppColors.success : AppColors.info,
              ),
              AppSpacing.gapSm,
              Expanded(
                child: Text(
                  context.tr(transferTypeKey(t.type)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleMedium,
                ),
              ),
              TransferStatusChip(status: t.status),
            ],
          ),
          if (t.number != null) ...[
            AppSpacing.gapXs,
            Text(
              t.number!,
              textDirection: TextDirection.ltr,
              style: text.titleSmall,
            ),
          ],
          AppSpacing.gapSm,
          Text('${t.from.name} → ${t.to.name}', style: text.bodyLarge),
          info(
            'transfer.created',
            [
              AlgiersDay.displayDateTime(t.createdAt),
              if (t.createdBy != null) t.createdBy!.fullName,
            ].join(' · '),
          ),
          if (t.validatedAt != null)
            info(
              'transfer.validated',
              AlgiersDay.displayDateTime(t.validatedAt!),
            ),
          if (t.cancelledAt != null)
            info(
              'transfer.cancelled',
              AlgiersDay.displayDateTime(t.cancelledAt!),
            ),
          if (t.cancelReason != null && t.cancelReason!.isNotEmpty)
            info('transfer.cancel_reason', t.cancelReason!),
          if (t.note != null && t.note!.isNotEmpty)
            info('transfer.note', t.note!),
        ],
      ),
    );
  }
}

/// The lines as saved: quantity in the entered unit, and the base
/// quantity when the unit is a packaging (`5 CRT` · `120 PCE`).
class TransferLinesCard extends StatelessWidget {
  const TransferLinesCard({super.key, required this.lines});

  final List<TransferLineDto> lines;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (lines.isEmpty) {
      return AppCard(
        child: Text(
          context.tr('transfer.no_lines'),
          style: text.bodyMedium?.copyWith(color: context.textMuted),
        ),
      );
    }
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            context.tr('truck.line_count', args: {'n': lines.length}),
            style: text.labelLarge?.copyWith(color: context.textMuted),
          ),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l.designation,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodyMedium,
                        ),
                        if (l.reference.isNotEmpty)
                          Text(
                            l.reference,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodySmall?.copyWith(
                              color: context.textMuted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  AppSpacing.gapSm,
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        Qty.withUnit(l.qty, l.unitCode),
                        style: text.titleSmall,
                      ),
                      if (l.qty != l.qtyBase)
                        Text(
                          Qty.format(l.qtyBase),
                          style: text.bodySmall?.copyWith(
                            color: context.textMuted,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
