import 'package:flutter/material.dart';

import '../../design/design.dart';
import '../../localization/tr.dart';

/// "‹ Aujourd'hui ›": steps one day back or forward ([onNext] null on
/// today: never a future day). Used by Équipe and Chargements.
class DayBar extends StatelessWidget {
  const DayBar({
    super.key,
    required this.label,
    required this.onPrevious,
    this.onNext,
  });

  final String label;
  final VoidCallback onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    // Arrows follow the reading direction: "previous" points to the start.
    final rtl = Directionality.of(context) == TextDirection.rtl;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: context.tr('team.previous_day'),
            onPressed: onPrevious,
            icon: Icon(
              rtl ? Icons.chevron_right_rounded : Icons.chevron_left_rounded,
            ),
          ),
          Expanded(
            child: Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          IconButton(
            tooltip: context.tr('team.next_day'),
            onPressed: onNext,
            icon: Icon(
              rtl ? Icons.chevron_left_rounded : Icons.chevron_right_rounded,
            ),
          ),
        ],
      ),
    );
  }
}
