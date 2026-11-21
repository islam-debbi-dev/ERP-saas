import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/net_image.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/guest_guard.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../catalog/ui/widgets/product_customizer.dart';
import '../data/models/cart_line.dart';
import '../logic/cart_cubit.dart';
import '../logic/cart_state.dart';
import 'widgets/qty_stepper.dart';
import 'widgets/order_summary.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return CartBuilder(
      builder: (context, cart) => Scaffold(
        appBar: AppBar(
          title: Text(context.tr('jb.cart.title')),
          actions: [
            if (!cart.isEmpty)
              TextButton(
                onPressed: () => _confirmClear(context),
                child: Text(context.tr('clear_all')),
              ),
          ],
        ),
        body: cart.isEmpty
            ? AppEmptyState(
                icon: Icons.shopping_bag_outlined,
                title: context.tr('jb.cart.empty_title'),
                message: context.tr('jb.cart.empty_message'),
                actionLabel: context.tr('jb.cart.custom_request_cta'),
                onAction: () => _checkout(context),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screenH,
                  AppSpacing.sm,
                  AppSpacing.screenH,
                  AppSpacing.xl,
                ),
                children: [
                  for (final group in groupCartLines(cart.lines)) ...[
                    if (group.storeName.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(
                          top: AppSpacing.sm,
                          bottom: AppSpacing.sm,
                        ),
                        child: Semantics(
                          header: true,
                          child: Text(
                            group.storeName,
                            style: AppTextStyles.h3.copyWith(
                              color: context.textMain,
                            ),
                          ),
                        ),
                      ),
                    for (final line in group.lines) ...[
                      _CartLineTile(
                        line: line,
                        error: cart.lineErrors[line.lineKey],
                      ),
                      const SizedBox(height: AppSpacing.md),
                    ],
                  ],
                  const SizedBox(height: AppSpacing.sm),
                  OrderSummary.fromCart(cart),
                  if (cart.loyalty case final loyalty?) ...[
                    const SizedBox(height: AppSpacing.md),
                    _Hint(
                      icon: Icons.card_giftcard_rounded,
                      text: loyalty.nextOrderFree
                          ? context.tr('jb.cart.loyalty_free_now')
                          : context.tr(
                              'jb.cart.loyalty_progress',
                              args: {'count': loyalty.ordersUntilFree},
                            ),
                    ),
                  ],
                ],
              ),
        bottomNavigationBar: cart.isEmpty ? null : _CheckoutBar(cart: cart),
      ),
    );
  }

  Future<void> _confirmClear(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(dialog.tr('jb.cart.clear_title')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(dialog.tr('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(dialog.tr('clear_all')),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) context.read<CartCubit>().clear();
  }

  static void _checkout(BuildContext context) {
    if (guardGuest(context)) return;
    context.push(Routes.checkout);
  }
}

/// Lines of one store, for the cart sections.
class CartStoreGroup {
  CartStoreGroup(this.storeId, this.storeName);

  final String storeId;
  final String storeName;
  final List<CartLine> lines = [];
}

/// Groups lines by store (stores in the order they were first added), and
/// keeps the lines of the same product next to each other (an assiette with
/// camembert right under the plain one).
List<CartStoreGroup> groupCartLines(List<CartLine> lines) {
  final groups = <String, CartStoreGroup>{};
  for (final line in lines) {
    groups.putIfAbsent(
      line.storeId,
      () => CartStoreGroup(line.storeId, line.storeName),
    );
  }
  for (final group in groups.values) {
    final storeLines = lines.where((l) => l.storeId == group.storeId).toList();
    final productOrder = <String>[];
    for (final line in storeLines) {
      if (!productOrder.contains(line.productId)) {
        productOrder.add(line.productId);
      }
    }
    for (final productId in productOrder) {
      group.lines.addAll(storeLines.where((l) => l.productId == productId));
    }
  }
  return groups.values.toList();
}

class _CartLineTile extends StatelessWidget {
  const _CartLineTile({required this.line, this.error});

  final CartLine line;

  /// Server refusal for this line (size / option no longer valid).
  final String? error;

  /// Reopens the product pre-filled to update this line.
  void _open(BuildContext context) =>
      context.push(Routes.product(line.productId), extra: line);

  @override
  Widget build(BuildContext context) {
    final cart = context.read<CartCubit>();
    final text = Theme.of(context).textTheme;
    return Dismissible(
      key: ValueKey(line.lineKey),
      direction: DismissDirection.endToStart,
      onDismissed: (_) => cart.remove(line.lineKey),
      background: Container(
        alignment: AlignmentDirectional.centerEnd,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
        decoration: const BoxDecoration(
          color: AppColors.error,
          borderRadius: AppRadius.lgAll,
        ),
        child: const Icon(Icons.delete_outline_rounded, color: AppColors.white),
      ),
      child: Semantics(
        onTapHint: context.tr('jb.cart.edit_line'),
        child: AppCard(
          padding: const EdgeInsets.all(AppSpacing.md),
          onTap: () => _open(context),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: AppRadius.mdAll,
                child: SizedBox(
                  width: 68,
                  height: 68,
                  child: NetImage(url: line.image, fit: BoxFit.fill),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      line.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleSmall,
                    ),
                    if (line.isCustomised)
                      ChoicesSummary(
                        size: line.variantLabel,
                        supplements: [
                          for (final o in line.supplements) o.label,
                        ],
                        instructions: [
                          for (final o in line.instructions) o.label,
                        ],
                      ),
                    if (error != null) ...[
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        error!,
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.error,
                        ),
                      ),
                      TextButton.icon(
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(0, AppSpacing.minTouch),
                        ),
                        onPressed: () => _open(context),
                        icon: const Icon(Icons.edit_rounded, size: 16),
                        label: Text(context.tr('jb.custom.fix')),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      formatDzd(context, line.lineTotal),
                      style: AppTextStyles.label.copyWith(
                        color: context.textMain,
                      ),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    onPressed: () => cart.remove(line.lineKey),
                    tooltip: context.tr('jb.cart.remove'),
                    visualDensity: VisualDensity.compact,
                    icon: Icon(
                      Icons.delete_outline_rounded,
                      size: 20,
                      color: context.textMuted,
                    ),
                  ),
                  QtyStepper(
                    label: formatQty(context, line.qty, line.unit),
                    onIncrement: () => cart.increment(line.lineKey),
                    onDecrement: () => cart.decrement(line.lineKey),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar({required this.cart});

  final CartState cart;

  @override
  Widget build(BuildContext context) {
    String? blocker;
    if (!cart.orderingEnabled) {
      blocker = context.tr('jb.home.closed_message');
    } else if (!cart.meetsMinimum) {
      blocker = context.tr(
        'jb.cart.min_order',
        args: {'amount': formatDzd(context, cart.minOrderAmount)},
      );
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.md,
        AppSpacing.screenH,
        AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: context.pageBackground,
        border: Border(top: BorderSide(color: context.fieldBorder)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (blocker != null)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Text(
                  blocker,
                  textAlign: TextAlign.center,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.warning,
                  ),
                ),
              ),
            AppButton(
              label:
                  '${context.tr('jb.cart.checkout')} · ${formatDzd(context, cart.total)}',
              onPressed: cart.canCheckout
                  ? () => CartScreen._checkout(context)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.isDarkMode
            ? AppColors.accent.withValues(alpha: 0.12)
            : AppColors.accentTint,
        borderRadius: AppRadius.mdAll,
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: context.textMain),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.caption.copyWith(color: context.textMain),
            ),
          ),
        ],
      ),
    );
  }
}
