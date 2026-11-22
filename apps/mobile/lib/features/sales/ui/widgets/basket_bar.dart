import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';

/// Pill floating above the product picker while the basket has lines: line
/// count, a label and the estimated total (adapted from the consumer cart's
/// floating bar). The count bumps when a line is added.
class BasketBar extends StatefulWidget {
  const BasketBar({
    super.key,
    required this.count,
    required this.total,
    required this.label,
    required this.onTap,
  });

  /// Space the bar takes; lists scrolling under it keep this at their end.
  static const double clearance = 56 + AppSpacing.sm * 2;

  final int count;

  /// The estimated TTC; null while the API prices the basket.
  final Decimal? total;
  final String label;
  final VoidCallback onTap;

  @override
  State<BasketBar> createState() => _BasketBarState();
}

class _BasketBarState extends State<BasketBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _bump = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );
  late final Animation<double> _scale = TweenSequence<double>([
    TweenSequenceItem(tween: Tween(begin: 1, end: 1.28), weight: 35),
    TweenSequenceItem(
      tween: Tween<double>(
        begin: 1.28,
        end: 1,
      ).chain(CurveTween(curve: Curves.elasticOut)),
      weight: 65,
    ),
  ]).animate(_bump);

  @override
  void didUpdateWidget(BasketBar old) {
    super.didUpdateWidget(old);
    if (widget.count > old.count && !MediaQuery.disableAnimationsOf(context)) {
      _bump.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _bump.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    final bg = dark ? AppColors.accent : AppColors.ink;
    final fg = dark ? AppColors.ink : AppColors.white;
    final badgeBg = dark ? AppColors.ink : AppColors.accent;
    final badgeFg = dark ? AppColors.accent : AppColors.ink;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final total = widget.total;
    return AnimatedSwitcher(
      duration: reduceMotion
          ? Duration.zero
          : const Duration(milliseconds: 260),
      child: widget.count == 0
          ? const SizedBox(width: double.infinity, key: ValueKey('empty'))
          : Padding(
              key: const ValueKey('bar'),
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.sm,
                AppSpacing.lg,
                AppSpacing.sm,
              ),
              child: Semantics(
                button: true,
                label: widget.label,
                child: DecoratedBox(
                  decoration: const BoxDecoration(
                    borderRadius: AppRadius.pillAll,
                    boxShadow: AppShadows.floating,
                  ),
                  child: Material(
                    color: bg,
                    borderRadius: AppRadius.pillAll,
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: widget.onTap,
                      child: Container(
                        height: 56,
                        padding: const EdgeInsetsDirectional.fromSTEB(
                          AppSpacing.sm,
                          0,
                          AppSpacing.lg,
                          0,
                        ),
                        child: Row(
                          children: [
                            ScaleTransition(
                              scale: _scale,
                              child: Container(
                                width: 40,
                                height: 40,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: badgeBg,
                                  shape: BoxShape.circle,
                                ),
                                child: Text(
                                  widget.count > 99 ? '99+' : '${widget.count}',
                                  style: AppTextStyles.label.copyWith(
                                    color: badgeFg,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: Text(
                                widget.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppTextStyles.button.copyWith(color: fg),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            if (total == null)
                              SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: fg,
                                ),
                              )
                            else
                              Text(
                                Money.format(total),
                                maxLines: 1,
                                textDirection: TextDirection.ltr,
                                style: AppTextStyles.label.copyWith(
                                  color: fg,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            const SizedBox(width: AppSpacing.xs),
                            Icon(
                              Directionality.of(context) == TextDirection.rtl
                                  ? Icons.chevron_left_rounded
                                  : Icons.chevron_right_rounded,
                              color: fg,
                              size: 22,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}
