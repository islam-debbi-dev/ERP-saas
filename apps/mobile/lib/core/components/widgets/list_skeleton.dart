import 'package:flutter/material.dart';

import '../../design/design.dart';

/// First-load placeholder for a list of cards (one shimmer for all rows).
class ListSkeleton extends StatelessWidget {
  const ListSkeleton({super.key, this.rows = 6, this.rowHeight = 72});

  final int rows;
  final double rowHeight;

  @override
  Widget build(BuildContext context) {
    return AppSkeletonGroup(
      child: ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: rows,
        separatorBuilder: (_, _) => AppSpacing.gapSm,
        itemBuilder: (_, _) =>
            AppSkeleton(height: rowHeight, radius: AppRadius.lg),
      ),
    );
  }
}
