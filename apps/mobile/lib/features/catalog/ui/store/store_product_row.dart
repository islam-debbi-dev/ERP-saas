import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/router/routes.dart';
import '../../../cart/ui/widgets/qty_stepper.dart';
import '../../data/models/product.dart';
import '../widgets/product_card.dart';

/// Restaurant-menu row: name, two lines of description and the price on
/// the reading side, the photo with the "+" on the other. Dishes with
/// descriptions read better this way than in a two-column grid.
class StoreProductRow extends StatefulWidget {
  const StoreProductRow({super.key, required this.product});

  final Product product;

  static const double imageSize = 104;

  @override
  State<StoreProductRow> createState() => _StoreProductRowState();
}

class _StoreProductRowState extends State<StoreProductRow> {
  /// The photo the fly-to-cart thumbnail starts from.
  final _photoKey = GlobalKey();

  static const double imageSize = StoreProductRow.imageSize;

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final description = product.description ?? '';
    return InkWell(
      onTap: () => context.push(Routes.product(product.id)),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenH,
          vertical: AppSpacing.lg,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.h3.copyWith(color: context.textMain),
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.body.copyWith(
                        color: context.textMuted,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.xs,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      PriceTag(product: product),
                      if (product.isCustomisable)
                        Tooltip(
                          message: context.tr('jb.custom.customisable'),
                          child: Icon(
                            Icons.tune_rounded,
                            size: 16,
                            semanticLabel: context.tr('jb.custom.customisable'),
                            color: context.textMuted,
                          ),
                        ),
                      InCartBadge(product: product),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            SizedBox(
              width: imageSize,
              height: imageSize + AppSpacing.md,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  ClipRRect(
                    key: _photoKey,
                    borderRadius: AppRadius.mdAll,
                    child: SizedBox(
                      width: imageSize,
                      height: imageSize,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          NetImage(
                            url: product.mainImage,
                            media: product.mainMedia,
                          ),
                          if (product.hasDiscount)
                            PositionedDirectional(
                              top: AppSpacing.xs,
                              start: AppSpacing.xs,
                              child: DiscountBadge(
                                percent: product.discountPercentage,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  PositionedDirectional(
                    end: AppSpacing.xs,
                    bottom: 0,
                    child: CartQtyControl(
                      product: product,
                      flightOrigin: _photoKey,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Grey placeholder rows while a section loads.
class StoreProductRowSkeleton extends StatelessWidget {
  const StoreProductRowSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(
        horizontal: AppSpacing.screenH,
        vertical: AppSpacing.lg,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppSkeleton(width: 160, height: 18),
                SizedBox(height: AppSpacing.sm),
                AppSkeleton(height: 12),
                SizedBox(height: AppSpacing.xs),
                AppSkeleton(width: 120, height: 12),
                SizedBox(height: AppSpacing.md),
                AppSkeleton(width: 70, height: 16),
              ],
            ),
          ),
          SizedBox(width: AppSpacing.md),
          AppSkeleton(
            width: StoreProductRow.imageSize,
            height: StoreProductRow.imageSize,
            radius: AppRadius.md,
          ),
        ],
      ),
    );
  }
}
