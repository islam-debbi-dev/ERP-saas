import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import '../../logic/cart_state.dart';

/// Subtotal / delivery / total block for the cart, checkout and order detail.
class OrderSummary extends StatelessWidget {
  const OrderSummary({
    super.key,
    required this.subtotal,
    required this.deliveryFee,
    required this.total,
    this.customRequestAmount,
    this.estimated = false,
  });

  factory OrderSummary.fromCart(CartState cart) => OrderSummary(
    subtotal: cart.subtotal,
    deliveryFee: cart.deliveryFee,
    total: cart.total,
    estimated: true,
  );

  final num subtotal;

  /// `null` until the admin confirms the fee by phone.
  final num? deliveryFee;
  final num total;
  final num? customRequestAmount;

  /// Cart totals are confirmed by the server when the order is placed.
  final bool estimated;

  @override
  Widget build(BuildContext context) {
    final fee = deliveryFee;
    return AppCard(
      child: Column(
        children: [
          _row(
            context,
            context.tr('jb.summary.subtotal'),
            formatDzd(context, subtotal),
          ),
          if (customRequestAmount != null && customRequestAmount! > 0)
            _row(
              context,
              context.tr('jb.summary.custom_request'),
              formatDzd(context, customRequestAmount!),
            ),
          _row(
            context,
            context.tr('jb.summary.delivery'),
            fee == null
                ? context.tr('jb.summary.delivery_to_confirm')
                : fee == 0
                ? context.tr('jb.summary.free')
                : formatDzd(context, fee),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Divider(height: 1, color: context.fieldBorder),
          ),
          _row(
            context,
            context.tr(
              fee == null
                  ? 'jb.summary.total_before_delivery'
                  : 'jb.summary.total',
            ),
            formatDzd(context, total),
            bold: true,
          ),
          if (fee == null) ...[
            const SizedBox(height: AppSpacing.xs),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.phone_in_talk_rounded,
                  size: 16,
                  color: context.textMuted,
                ),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    context.tr('jb.summary.delivery_call_note'),
                    style: AppTextStyles.caption.copyWith(
                      color: context.textMuted,
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (estimated) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              context.tr('jb.summary.cod_note'),
              style: AppTextStyles.caption.copyWith(color: context.textMuted),
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(
    BuildContext context,
    String label,
    String value, {
    bool bold = false,
  }) {
    final style = (bold ? AppTextStyles.h2 : AppTextStyles.body).copyWith(
      color: bold ? context.textMain : context.textMuted,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style.copyWith(color: context.textMain)),
        ],
      ),
    );
  }
}
