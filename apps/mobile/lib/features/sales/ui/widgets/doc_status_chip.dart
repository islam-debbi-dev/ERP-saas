import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';

/// Coloured pill for a document status (sale: DRAFT / VALIDATED / CANCELLED;
/// order: DRAFT / CONFIRMED / DELIVERED / CANCELLED), adapted from the
/// consumer order chip. Labels are `status.<STATUS>`.
class DocStatusChip extends StatelessWidget {
  const DocStatusChip({super.key, required this.status});

  final String status;

  static Color colorOf(String status) => switch (status) {
    'DRAFT' => AppColors.warning,
    'CONFIRMED' => AppColors.info,
    'VALIDATED' || 'DELIVERED' => AppColors.success,
    'CANCELLED' => AppColors.error,
    _ => AppColors.textTertiary,
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
        context.tr('status.$status'),
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
