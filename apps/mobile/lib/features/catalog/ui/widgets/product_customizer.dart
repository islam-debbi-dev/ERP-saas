import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/components/widgets/staggered_entrance.dart';
import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import '../../../cart/data/models/cart_line.dart';
import '../../data/models/product.dart';
import '../../logic/customisation_rules.dart';

/// Selection state shared by [ProductCustomizer] and [CustomizerAddBar].
/// All the arithmetic lives in [CustomisationRules]; this only holds state.
class CustomisationController extends ChangeNotifier {
  CustomisationController(Product product, {CartLine? editing})
    : rules = CustomisationRules(product),
      editingKey = editing?.lineKey,
      _qty = editing?.qty ?? product.unitStep {
    _selection = editing == null ? rules.initial() : rules.fromLine(editing);
  }

  final CustomisationRules rules;

  /// Key of the cart line being edited, `null` when adding a new one.
  final String? editingKey;

  late CustomisationSelection _selection;
  num _qty;

  Product get product => rules.product;
  CustomisationSelection get selection => _selection;
  num get qty => _qty;
  CustomisationProblem? get problem => rules.problem(_selection);
  bool get isValid => problem == null;
  num get total => rules.total(_selection, _qty);

  void selectVariant(ProductVariant variant) {
    _selection = rules.selectVariant(_selection, variant);
    notifyListeners();
  }

  void toggle(ProductOptionGroup group, ProductOption option) {
    _selection = rules.toggle(_selection, group, option);
    notifyListeners();
  }

  void increment() {
    _qty = _round(_qty + product.unitStep);
    notifyListeners();
  }

  void decrement() {
    if (_qty - product.unitStep < product.unitStep - 1e-9) return;
    _qty = _round(_qty - product.unitStep);
    notifyListeners();
  }

  CartLine toLine() => rules.toLine(_selection, _qty);

  /// Back to nothing picked and one unit, so the client can add the same
  /// dish again with other choices.
  void reset() {
    _selection = rules.initial();
    _qty = product.unitStep;
    notifyListeners();
  }

  static num _round(num qty) {
    final value = (qty * 1000).round() / 1000;
    return value == value.roundToDouble() ? value.toInt() : value;
  }
}

/// Size pills, supplement and instruction rows for one product, as iOS-style
/// grouped sections. Pure selection UI over a [CustomisationController]
/// (the rules live in `customisation_rules.dart`).
class ProductCustomizer extends StatelessWidget {
  const ProductCustomizer({
    super.key,
    required this.controller,
    this.animateIn = false,
  });

  final CustomisationController controller;

  /// Sections slide in with a short stagger when the page first opens
  /// (fade only with Reduce Motion). Presentation only.
  final bool animateIn;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final product = controller.product;
        final sections = <Widget>[
          if (product.variants.isNotEmpty) _SizeSection(controller),
          for (final group in product.optionGroups)
            if (group.options.isNotEmpty) _GroupSection(controller, group),
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < sections.length; i++)
              StaggeredEntrance(
                index: i + 1,
                enabled: animateIn,
                step: const Duration(milliseconds: 60),
                maxDelay: const Duration(milliseconds: 240),
                duration: const Duration(milliseconds: 280),
                child: sections[i],
              ),
          ],
        );
      },
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.required,
    this.badge,
    this.hint,
  });

  final String title;

  /// Required sections get the yellow badge, optional ones a grey one.
  final bool required;
  final String? badge;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final label =
        badge ??
        context.tr(required ? 'jb.custom.required' : 'jb.custom.optional');
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xl, bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: AppTextStyles.h3.copyWith(color: context.textMain),
                  ),
                ),
                if (hint != null)
                  Text(
                    hint!,
                    style: AppTextStyles.caption.copyWith(
                      color: context.textMuted,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: AppSpacing.xxs + 1,
            ),
            decoration: BoxDecoration(
              color: required
                  ? (context.isDarkMode
                        ? AppColors.accent.withValues(alpha: 0.18)
                        : AppColors.accentTint)
                  : context.fieldFill,
              borderRadius: AppRadius.pillAll,
            ),
            child: Text(
              label,
              style: AppTextStyles.caption.copyWith(
                color: required ? context.textMain : context.textMuted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SizeSection extends StatelessWidget {
  const _SizeSection(this.controller);

  final CustomisationController controller;

  @override
  Widget build(BuildContext context) {
    final variants = controller.product.variants;
    final discount = controller.product.discountPercentage;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(title: context.tr('jb.custom.size'), required: true),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final v in variants)
              _SizePill(
                label: v.isAvailable
                    ? '${v.label} · ${formatDzd(context, v.finalPrice ?? applyDiscount(v.price, discount))}'
                    : '${v.label} · ${context.tr('jb.custom.unavailable')}',
                enabled: v.isAvailable,
                selected: controller.selection.variantId == v.id,
                onTap: () => controller.selectVariant(v),
              ),
          ],
        ),
      ],
    );
  }
}

/// Segmented-style size pill: filled when picked, outlined otherwise.
class _SizePill extends StatelessWidget {
  const _SizePill({
    required this.label,
    required this.enabled,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool enabled;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      inMutuallyExclusiveGroup: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.45,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          decoration: ShapeDecoration(
            color: selected ? AppColors.accent : Colors.transparent,
            shape: StadiumBorder(
              side: BorderSide(
                color: selected ? AppColors.accent : context.fieldBorder,
              ),
            ),
          ),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: enabled
                  ? () {
                      HapticFeedback.selectionClick();
                      onTap();
                    }
                  : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        label,
                        style: AppTextStyles.label.copyWith(
                          color: selected ? AppColors.ink : context.textMain,
                        ),
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

class _GroupSection extends StatelessWidget {
  const _GroupSection(this.controller, this.group);

  final CustomisationController controller;
  final ProductOptionGroup group;

  @override
  Widget build(BuildContext context) {
    final String? badge;
    if (group.minSelect >= 1) {
      badge = context.tr(
        group.isSingleChoice ? 'jb.custom.choose_one' : 'jb.custom.required',
      );
    } else if (group.isSingleChoice) {
      badge = context.tr('jb.custom.only_one');
    } else {
      badge = null;
    }
    final hint = group.isInstruction
        ? context.tr('jb.custom.instructions_hint')
        : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: group.name,
          required: group.minSelect >= 1,
          badge: badge,
          hint: hint,
        ),
        ClipRRect(
          borderRadius: AppRadius.lgAll,
          child: ColoredBox(
            color: context.fieldFill,
            child: Column(
              children: [
                for (final (i, option) in group.options.indexed) ...[
                  if (i > 0)
                    Divider(
                      height: 0.5,
                      thickness: 0.5,
                      indent: AppSpacing.lg + 22 + AppSpacing.md,
                      color: context.fieldBorder,
                    ),
                  _OptionRow(
                    group: group,
                    option: option,
                    selected: controller.selection.optionIds.contains(
                      option.id,
                    ),
                    onTap: () => controller.toggle(group, option),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _OptionRow extends StatelessWidget {
  const _OptionRow({
    required this.group,
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final ProductOptionGroup group;
  final ProductOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = option.isAvailable;
    final String trailing;
    if (!enabled) {
      trailing = context.tr('jb.custom.unavailable');
    } else if (group.isInstruction) {
      trailing = context.tr('jb.custom.free');
    } else {
      trailing = option.price > 0
          ? '+${formatDzd(context, option.price)}'
          : context.tr('jb.custom.free');
    }

    return Semantics(
      checked: selected,
      enabled: enabled,
      inMutuallyExclusiveGroup: group.isSingleChoice,
      child: InkWell(
        onTap: enabled
            ? () {
                HapticFeedback.selectionClick();
                onTap();
              }
            : null,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm,
            ),
            child: Opacity(
              opacity: enabled ? 1 : 0.45,
              child: Row(
                children: [
                  _CheckMark(selected: selected, round: group.isSingleChoice),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(
                      option.label,
                      style: AppTextStyles.bodyLarge.copyWith(
                        color: context.textMain,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    trailing,
                    style: AppTextStyles.label.copyWith(
                      color: group.isInstruction || !enabled
                          ? context.textMuted
                          : context.textMain,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Rounded-square tick (multi choice) or ring (single choice), filled when
/// selected.
class _CheckMark extends StatelessWidget {
  const _CheckMark({required this.selected, required this.round});

  final bool selected;
  final bool round;

  @override
  Widget build(BuildContext context) {
    final fill = context.isDarkMode ? AppColors.accent : AppColors.ink;
    final tick = context.isDarkMode ? AppColors.ink : AppColors.white;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        color: selected ? fill : Colors.transparent,
        shape: round ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: round ? null : BorderRadius.circular(6),
        border: Border.all(
          color: selected ? fill : context.textFaint,
          width: 1.5,
        ),
      ),
      child: selected ? Icon(Icons.check_rounded, size: 16, color: tick) : null,
    );
  }
}

/// Sticky bottom bar: quantity stepper and "Add · 1 200 DA" with the live
/// total; disabled with a short reason until every required choice is made.
class CustomizerAddBar extends StatelessWidget {
  const CustomizerAddBar({
    super.key,
    required this.controller,
    required this.enabled,
    required this.onAdd,
    this.disabledReason,
  });

  final CustomisationController controller;

  /// Ordering open, store open and product available.
  final bool enabled;
  final VoidCallback onAdd;

  /// Shown instead of the choice reason when [enabled] is false.
  final String? disabledReason;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final problem = controller.problem;
        final choiceReason = switch (problem) {
          NeedSize() => context.tr('jb.custom.pick_size'),
          GroupRuleBroken(:final group) => context.tr(
            'jb.custom.pick_group',
            args: {'group': group.name},
          ),
          null => null,
        };
        final reason = enabled ? choiceReason : disabledReason;
        final label = context.tr(
          controller.editingKey == null
              ? 'jb.custom.add_to_cart_total'
              : 'jb.custom.update_line_total',
          args: {'amount': formatDzd(context, controller.total)},
        );
        final bg = context.isDarkMode
            ? AppColors.darkSurface
            : AppColors.surface;
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (reason != null)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Text(
                  reason,
                  textAlign: TextAlign.center,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.warning,
                  ),
                ),
              ),
            Row(
              children: [
                Container(
                  height: 52,
                  decoration: BoxDecoration(
                    color: bg,
                    borderRadius: AppRadius.mdAll,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        onPressed: controller.decrement,
                        icon: const Icon(Icons.remove_rounded, size: 18),
                        tooltip: context.tr('jb.custom.less'),
                      ),
                      ConstrainedBox(
                        constraints: const BoxConstraints(minWidth: 24),
                        child: Text(
                          formatQty(
                            context,
                            controller.qty,
                            controller.product.unit,
                          ),
                          textAlign: TextAlign.center,
                          style: AppTextStyles.label.copyWith(
                            color: context.textMain,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: controller.increment,
                        icon: const Icon(Icons.add_rounded, size: 18),
                        tooltip: context.tr('jb.custom.more'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    key: const ValueKey('customizer-add'),
                    label: label,
                    onPressed: enabled && problem == null ? onAdd : null,
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}

/// Size, supplements and instructions under a product name (cart, order
/// detail): "XL", "+ Salade, Camembert", "Sans tomate, Sans frites".
class ChoicesSummary extends StatelessWidget {
  const ChoicesSummary({
    super.key,
    this.size,
    this.supplements = const [],
    this.instructions = const [],
  });

  final String? size;
  final List<String> supplements;
  final List<String> instructions;

  @override
  Widget build(BuildContext context) {
    final muted = AppTextStyles.caption.copyWith(color: context.textMuted);
    final sep = Directionality.of(context) == TextDirection.rtl ? '، ' : ', ';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (size != null && size!.isNotEmpty)
          Text(
            '${context.tr('jb.custom.size')}: $size',
            style: AppTextStyles.caption.copyWith(color: context.textMain),
          ),
        if (supplements.isNotEmpty)
          Text('+ ${supplements.join(sep)}', style: muted),
        if (instructions.isNotEmpty)
          Text(
            instructions.join(sep),
            // Muted but bold, so a "sans" stays noticeable and readable on
            // the grey cart card (yellow text failed contrast there).
            style: AppTextStyles.caption.copyWith(
              color: context.textMuted,
              fontWeight: FontWeight.w700,
            ),
          ),
      ],
    );
  }
}
