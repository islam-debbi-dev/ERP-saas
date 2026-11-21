import '../../cart/data/models/cart_line.dart';
import '../data/models/product.dart';

/// Stable key of a cart / order line: `productId|variantId|sorted optionIds`.
/// Must match `lineKey()` in `backend/src/services/order.service.js`.
String lineKeyOf(
  String productId, {
  String? variantId,
  Iterable<String> optionIds = const [],
}) {
  final options = optionIds.toSet().toList()..sort();
  return '$productId|${variantId ?? ''}|${options.join(',')}';
}

/// What the client picked for one product: a size and ticked options.
class CustomisationSelection {
  const CustomisationSelection({this.variantId, this.optionIds = const {}});

  final String? variantId;
  final Set<String> optionIds;

  CustomisationSelection copyWith({
    String? variantId,
    Set<String>? optionIds,
  }) => CustomisationSelection(
    variantId: variantId ?? this.variantId,
    optionIds: optionIds ?? this.optionIds,
  );
}

/// Why the "Add" button is disabled.
sealed class CustomisationProblem {
  const CustomisationProblem();
}

/// A size must be picked.
class NeedSize extends CustomisationProblem {
  const NeedSize();
}

/// [group] needs between `minSelect` and `maxSelect` options.
class GroupRuleBroken extends CustomisationProblem {
  const GroupRuleBroken(this.group);
  final ProductOptionGroup group;
}

/// The pure rules behind `ProductCustomizer`: validity, total and line key,
/// with the same arithmetic as the server (`resolveLineChoice`). No Flutter
/// here, so the widget can be restyled freely.
class CustomisationRules {
  const CustomisationRules(this.product);

  final Product product;

  List<ProductVariant> get availableVariants =>
      product.variants.where((v) => v.isAvailable).toList();

  /// Nothing picked, except the size when only one is available.
  CustomisationSelection initial() {
    final available = availableVariants;
    return CustomisationSelection(
      variantId: available.length == 1 ? available.first.id : null,
    );
  }

  /// Pre-fills the selection from a cart line being edited, dropping ids
  /// that no longer exist or are unavailable.
  CustomisationSelection fromLine(CartLine line) {
    final validVariant = availableVariants.any((v) => v.id == line.variantId)
        ? line.variantId
        : initial().variantId;
    final validOptions = {
      for (final group in product.optionGroups)
        for (final option in group.options)
          if (option.isAvailable) option.id,
    };
    return CustomisationSelection(
      variantId: validVariant,
      optionIds: line.options
          .map((o) => o.id)
          .where(validOptions.contains)
          .toSet(),
    );
  }

  /// Ticks or unticks [option]. In a single-choice group, picking one
  /// replaces the previous choice; a full multi-choice group ignores extras.
  CustomisationSelection toggle(
    CustomisationSelection selection,
    ProductOptionGroup group,
    ProductOption option,
  ) {
    if (!option.isAvailable) return selection;
    final ids = {...selection.optionIds};
    final inGroup = group.options.map((o) => o.id).toSet();
    if (ids.contains(option.id)) {
      // A required single choice cannot be emptied by tapping it again.
      if (!(group.isSingleChoice && group.minSelect >= 1)) {
        ids.remove(option.id);
      }
    } else if (group.isSingleChoice) {
      ids
        ..removeAll(inGroup)
        ..add(option.id);
    } else if (ids.intersection(inGroup).length < group.effectiveMax) {
      ids.add(option.id);
    }
    return selection.copyWith(optionIds: ids);
  }

  CustomisationSelection selectVariant(
    CustomisationSelection selection,
    ProductVariant variant,
  ) => variant.isAvailable
      ? CustomisationSelection(
          variantId: variant.id,
          optionIds: selection.optionIds,
        )
      : selection;

  /// First reason the selection can't be added yet, or `null`.
  CustomisationProblem? problem(CustomisationSelection selection) {
    if (product.variants.isNotEmpty) {
      final ok = availableVariants.any((v) => v.id == selection.variantId);
      if (!ok) return const NeedSize();
    }
    for (final group in product.optionGroups) {
      final count = group.options
          .where((o) => selection.optionIds.contains(o.id))
          .length;
      if (count < group.minSelect || count > group.effectiveMax) {
        return GroupRuleBroken(group);
      }
    }
    return null;
  }

  bool isValid(CustomisationSelection selection) => problem(selection) == null;

  ProductVariant? variantOf(CustomisationSelection selection) {
    for (final v in product.variants) {
      if (v.id == selection.variantId) return v;
    }
    return null;
  }

  /// Size (or product) price after discount, before supplements.
  num basePrice(CustomisationSelection selection) {
    final variant = variantOf(selection);
    if (variant == null) return product.finalPrice;
    return variant.finalPrice ??
        applyDiscount(variant.price, product.discountPercentage);
  }

  /// Ticked options in display order (group by group).
  List<CartOption> chosenOptions(CustomisationSelection selection) => [
    for (final group in product.optionGroups)
      for (final option in group.options)
        if (selection.optionIds.contains(option.id))
          CartOption(
            id: option.id,
            kind: group.kind,
            label: option.label,
            price: group.isInstruction ? 0 : option.price,
          ),
  ];

  /// `finalPrice(size or base) + Σ supplements` — the discount never touches
  /// supplements, instructions are free.
  num unitPrice(CustomisationSelection selection) =>
      basePrice(selection) +
      chosenOptions(selection).fold<num>(0, (sum, o) => sum + o.price);

  /// Live total shown on the "Add" button.
  num total(CustomisationSelection selection, num qty) =>
      (unitPrice(selection) * qty).round();

  String lineKey(CustomisationSelection selection) => lineKeyOf(
    product.id,
    variantId: selection.variantId,
    optionIds: selection.optionIds,
  );

  /// The cart line for this selection.
  CartLine toLine(CustomisationSelection selection, num qty) {
    final variant = variantOf(selection);
    return CartLine.fromProduct(product, qty).copyWith(
      unitPrice: unitPrice(selection),
      variantId: variant?.id,
      variantLabel: variant?.label,
      options: chosenOptions(selection),
    );
  }
}

/// Same rounding as the server's `applyDiscount` (integer DZD).
num applyDiscount(num price, num discountPercentage) {
  final d = discountPercentage.clamp(0, 100);
  return (price.round() * (1 - d / 100)).round();
}
