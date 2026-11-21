import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/router/routes.dart';
import '../../../cart/logic/cart_cubit.dart';
import '../../../cart/ui/widgets/qty_stepper.dart';
import '../../data/models/product.dart';

/// The one product card used by Home, the category tabs, store pages,
/// search and related products.
class ProductCard extends StatefulWidget {
  const ProductCard({super.key, required this.product, this.showStore = true});

  final Product product;
  final bool showStore;

  /// Grid tiles size well at this width : height ratio.
  static const double aspectRatio = 0.62;

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  /// The photo the fly-to-cart thumbnail starts from.
  final _photoKey = GlobalKey();

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final showStore = widget.showStore;
    final text = Theme.of(context).textTheme;
    return Material(
      color: context.isDarkMode ? AppColors.darkSurface : AppColors.white,
      borderRadius: AppRadius.lgAll,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(Routes.product(product.id)),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: AppRadius.lgAll,
            border: Border.all(color: context.fieldBorder),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Stack(
                  key: _photoKey,
                  fit: StackFit.expand,
                  children: [
                    // Cover fills the tile without stretching the photo.
                    NetImage(url: product.mainImage, media: product.mainMedia),
                    if (!product.isAvailable)
                      ColoredBox(
                        color: AppColors.white.withValues(alpha: 0.55),
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppSpacing.md,
                              vertical: AppSpacing.xs,
                            ),
                            decoration: const BoxDecoration(
                              color: AppColors.ink,
                              borderRadius: AppRadius.pillAll,
                            ),
                            child: Text(
                              context.tr('unavailable'),
                              style: AppTextStyles.caption.copyWith(
                                color: AppColors.white,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (product.hasDiscount)
                      PositionedDirectional(
                        top: AppSpacing.sm,
                        start: AppSpacing.sm,
                        child: DiscountBadge(
                          percent: product.discountPercentage,
                        ),
                      ),
                    PositionedDirectional(
                      top: AppSpacing.sm,
                      end: AppSpacing.sm,
                      child: InCartBadge(product: product),
                    ),
                    if (product.isCustomisable)
                      PositionedDirectional(
                        bottom: AppSpacing.sm,
                        start: AppSpacing.sm,
                        child: const _CustomisableHint(),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.sm,
                  AppSpacing.md,
                  AppSpacing.md,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleSmall?.copyWith(height: 1.25),
                    ),
                    if (showStore && product.store != null) ...[
                      const SizedBox(height: AppSpacing.xxs),
                      Text(
                        product.store!.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall,
                      ),
                    ],
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(child: PriceTag(product: product)),
                        CartQtyControl(
                          product: product,
                          flightOrigin: _photoKey,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "2 in cart" on a customisable product: its total quantity across all
/// its cart lines (one product can be several lines). Plain products show
/// their inline stepper instead, so the badge stays hidden for them.
class InCartBadge extends StatelessWidget {
  const InCartBadge({super.key, required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    if (!product.isCustomisable) return const SizedBox.shrink();
    final qty = context.select<CartCubit, num>(
      (c) => c.qtyOfProduct(product.id),
    );
    if (qty <= 0) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xxs + 1,
      ),
      decoration: BoxDecoration(
        color: context.isDarkMode ? AppColors.yellow : AppColors.ink,
        borderRadius: AppRadius.pillAll,
      ),
      child: Text(
        context.tr(
          'jb.custom.in_cart_count',
          args: {'count': formatQty(context, qty, product.unit)},
        ),
        style: AppTextStyles.caption.copyWith(
          color: context.isDarkMode ? AppColors.ink : AppColors.white,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Small "tune" disc on a card photo: this product has sizes / options.
class _CustomisableHint extends StatelessWidget {
  const _CustomisableHint();

  @override
  Widget build(BuildContext context) {
    final label = context.tr('jb.custom.customisable');
    return Tooltip(
      message: label,
      child: Container(
        width: 26,
        height: 26,
        decoration: BoxDecoration(
          color: context.pageBackground.withValues(alpha: 0.92),
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.tune_rounded,
          size: 15,
          color: context.textMain,
          semanticLabel: label,
        ),
      ),
    );
  }
}

/// Final price (bold) with the original struck through when discounted, and
/// the sale unit for weight / volume products.
class PriceTag extends StatelessWidget {
  const PriceTag({
    super.key,
    required this.product,
    this.large = false,
    this.style,
  });

  final Product product;
  final bool large;

  /// Overrides the price style (the premium dish card's 17 pt).
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final unit = product.unit == 'piece'
        ? ''
        : ' / ${context.tr('jb.unit.${product.unit}')}';
    final style =
        (this.style ?? (large ? AppTextStyles.h2 : AppTextStyles.label))
            .copyWith(color: context.textMain, fontWeight: FontWeight.w800);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (product.hasDiscount)
          Text(
            formatDzd(context, product.displayOriginalPrice),
            maxLines: 1,
            style: AppTextStyles.caption.copyWith(
              color: context.textFaint,
              decoration: TextDecoration.lineThrough,
            ),
          ),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            // "from 800 DA" when the product comes in several sizes.
            product.isSized
                ? '${context.tr('jb.custom.from')} ${formatDzd(context, product.displayPrice)}$unit'
                : '${formatDzd(context, product.finalPrice)}$unit',
            style: style,
          ),
        ),
      ],
    );
  }
}

class DiscountBadge extends StatelessWidget {
  const DiscountBadge({super.key, required this.percent});

  final num percent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xxs + 1,
      ),
      decoration: const BoxDecoration(
        color: AppColors.yellow,
        borderRadius: AppRadius.pillAll,
      ),
      child: Text(
        '-${percent.round()}%',
        style: AppTextStyles.caption.copyWith(
          color: AppColors.ink,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
