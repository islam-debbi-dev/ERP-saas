import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../data/models/order.dart';

String orderStatusLabel(BuildContext context, OrderStatus status) =>
    context.tr('jb.order_status.${status.name}');

/// Colored pill for an order status.
class OrderStatusChip extends StatelessWidget {
  const OrderStatusChip({super.key, required this.status});

  final OrderStatus status;

  static Color colorOf(OrderStatus status) => switch (status) {
    OrderStatus.pending => AppColors.warning,
    OrderStatus.confirmed => AppColors.info,
    OrderStatus.outForDelivery => AppColors.accentDeep,
    OrderStatus.delivered => AppColors.success,
    OrderStatus.cancelled => AppColors.error,
  };

  @override
  Widget build(BuildContext context) {
    final color = colorOf(status);
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
        orderStatusLabel(context, status),
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
