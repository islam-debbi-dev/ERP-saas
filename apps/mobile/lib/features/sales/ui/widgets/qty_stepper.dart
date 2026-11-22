import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';

/// Pill with − quantity + (adapted from the consumer cart's stepper for the
/// sale basket). Colours come from the theme tokens.
class QtyStepper extends StatelessWidget {
  const QtyStepper({
    super.key,
    required this.label,
    required this.onDecrement,
    this.onIncrement,
    this.onTapLabel,
    this.expand = false,
    this.decrementTooltip,
    this.incrementTooltip,
  });

  /// The quantity as shown (`12`, `2,5`), LTR.
  final String label;
  final VoidCallback? onIncrement;
  final VoidCallback onDecrement;

  /// Tapping the number types a quantity.
  final VoidCallback? onTapLabel;
  final bool expand;
  final String? decrementTooltip;
  final String? incrementTooltip;

  @override
  Widget build(BuildContext context) {
    final bg = context.isDarkMode ? AppColors.accent : AppColors.ink;
    final fg = context.isDarkMode ? AppColors.ink : AppColors.white;
    final text = InkWell(
      onTap: onTapLabel,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
        child: Text(
          label,
          maxLines: 1,
          textAlign: TextAlign.center,
          textDirection: TextDirection.ltr,
          style: AppTextStyles.label.copyWith(color: fg),
        ),
      ),
    );
    return Container(
      height: AppSpacing.minTouch,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: expand ? AppRadius.mdAll : AppRadius.pillAll,
      ),
      child: Row(
        mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
        children: [
          _StepIcon(
            icon: Icons.remove_rounded,
            color: fg,
            tooltip: decrementTooltip,
            onTap: onDecrement,
          ),
          if (expand)
            Expanded(child: text)
          else
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 28),
              child: text,
            ),
          _StepIcon(
            icon: Icons.add_rounded,
            color: fg,
            tooltip: incrementTooltip,
            onTap: onIncrement,
          ),
        ],
      ),
    );
  }
}

class _StepIcon extends StatelessWidget {
  const _StepIcon({
    required this.icon,
    required this.color,
    this.onTap,
    this.tooltip,
  });

  final IconData icon;
  final Color color;
  final VoidCallback? onTap;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final button = InkResponse(
      onTap: onTap,
      radius: 24,
      child: SizedBox(
        width: AppSpacing.minTouch,
        height: AppSpacing.minTouch,
        child: Icon(
          icon,
          size: 20,
          color: onTap == null ? color.withValues(alpha: 0.4) : color,
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip!, child: button);
  }
}
