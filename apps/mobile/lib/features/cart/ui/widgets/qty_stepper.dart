import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/router/routes.dart';
import '../../../catalog/data/models/product.dart';
import '../../../catalog/logic/customisation_rules.dart';
import '../../logic/cart_cubit.dart';
import '../../logic/cart_state.dart';
import 'cart_flight.dart';

/// "Add" button that turns into a − qty + stepper once the product is in
/// the cart. Steps follow the product's `unitStep` (e.g. 0.5 kg).
///
/// A product with sizes / supplements / instructions is never added from
/// here: the button opens the product so the client can choose.
class CartQtyControl extends StatelessWidget {
  const CartQtyControl({
    super.key,
    required this.product,
    this.compact = true,
    this.flightOrigin,
  });

  final Product product;

  /// The product photo the fly-to-cart thumbnail starts from; without it,
  /// the thumbnail starts from the tapped button.
  final GlobalKey? flightOrigin;

  /// Compact = round icon button on cards; full = wide button on details.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (product.isCustomisable) return _ChooseButton(product: product);
    // A plain product has one line, keyed by its id alone.
    final key = lineKeyOf(product.id);
    final qty = context.select<CartCubit, num>(
      (cubit) => cubit.state.qtyOfLine(key),
    );
    final ordering = context.select<CartCubit, bool>(
      (cubit) => cubit.state.orderingEnabled,
    );
    final cart = context.read<CartCubit>();
    final canAdd = ordering && product.isAvailable && product.storeIsOpen;
    // Each add flies a thumbnail to the cart icon (or adds at once when
    // there is no icon to fly to).
    void add(BuildContext button) => CartFlight.add(
      flightOrigin?.currentContext ?? button,
      product: product,
      commit: () => cart.add(product),
    );

    if (qty == 0) {
      if (!compact) {
        return Builder(
          builder: (button) => AppButton(
            label: context.tr('jb.cart.add'),
            icon: Icons.add_shopping_cart_rounded,
            onPressed: canAdd ? () => add(button) : null,
          ),
        );
      }
      return Builder(
        builder: (button) => _RoundButton(
          icon: Icons.add_rounded,
          filled: true,
          tooltip: context.tr('jb.cart.add'),
          onTap: canAdd ? () => add(button) : null,
        ),
      );
    }

    return QtyStepper(
      label: formatQty(context, qty, product.unit),
      expand: !compact,
      onIncrementFrom: canAdd ? add : null,
      onDecrement: () => cart.decrement(key),
    );
  }
}

/// Round "+" of a customisable product: opens it to pick size / options.
class _ChooseButton extends StatelessWidget {
  const _ChooseButton({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final ordering = context.select<CartCubit, bool>(
      (cubit) => cubit.state.orderingEnabled,
    );
    return _RoundButton(
      icon: Icons.add_rounded,
      filled: true,
      tooltip: context.tr('jb.custom.choose'),
      onTap: ordering && product.isAvailable && product.storeIsOpen
          ? () => context.push(Routes.product(product.id))
          : null,
    );
  }
}

/// Pill with − label + used by cards, details and the cart list.
class QtyStepper extends StatelessWidget {
  const QtyStepper({
    super.key,
    required this.label,
    this.onIncrement,
    required this.onDecrement,
    this.expand = false,
    this.onIncrementFrom,
  });

  final String label;
  final VoidCallback? onIncrement;

  /// Like [onIncrement], with the "+" button's context (fly-to-cart origin).
  final ValueChanged<BuildContext>? onIncrementFrom;
  final VoidCallback onDecrement;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final bg = context.isDarkMode ? AppColors.yellow : AppColors.ink;
    final fg = context.isDarkMode ? AppColors.ink : AppColors.white;
    final text = Text(
      label,
      maxLines: 1,
      textAlign: TextAlign.center,
      style: AppTextStyles.label.copyWith(color: fg),
    );
    return Container(
      height: expand ? 52 : 40,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: expand ? AppRadius.mdAll : AppRadius.pillAll,
      ),
      child: Row(
        mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
        children: [
          _StepIcon(icon: Icons.remove_rounded, color: fg, onTap: onDecrement),
          if (expand)
            Expanded(child: text)
          else
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 22),
              child: text,
            ),
          Builder(
            builder: (plus) => _StepIcon(
              icon: Icons.add_rounded,
              color: fg,
              onTap: onIncrementFrom != null
                  ? () => onIncrementFrom!(plus)
                  : onIncrement,
            ),
          ),
        ],
      ),
    );
  }
}

class _StepIcon extends StatelessWidget {
  const _StepIcon({required this.icon, required this.color, this.onTap});

  final IconData icon;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkResponse(
      onTap: onTap,
      radius: 22,
      child: SizedBox(
        width: 40,
        height: 40,
        child: Icon(
          icon,
          size: 18,
          color: onTap == null ? color.withValues(alpha: 0.4) : color,
        ),
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.icon,
    required this.onTap,
    required this.tooltip,
    this.filled = false,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String tooltip;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final bg = context.isDarkMode ? AppColors.yellow : AppColors.ink;
    final fg = context.isDarkMode ? AppColors.ink : AppColors.white;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: onTap == null ? bg.withValues(alpha: 0.35) : bg,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, size: 22, color: fg),
          ),
        ),
      ),
    );
  }
}

/// Watches only what a cart badge needs.
int cartLineCount(BuildContext context) =>
    context.select<CartCubit, int>((c) => c.state.lineCount);

/// Rebuilds [builder] with the full cart state.
class CartBuilder extends StatelessWidget {
  const CartBuilder({super.key, required this.builder});

  final Widget Function(BuildContext context, CartState state) builder;

  @override
  Widget build(BuildContext context) =>
      BlocBuilder<CartCubit, CartState>(builder: builder);
}
