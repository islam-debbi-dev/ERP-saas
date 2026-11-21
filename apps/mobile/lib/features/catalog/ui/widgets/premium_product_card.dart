import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/router/routes.dart';
import '../../../cart/ui/widgets/qty_stepper.dart';
import '../../data/models/product.dart';
import 'pressable_card.dart';
import 'product_card.dart';
import 'store_tile.dart';

/// Hero tag shared by the dish card photo and the product page header.
String productPhotoHeroTag(String productId) => 'product-photo-$productId';

/// Flies the card's photo both ways (not the product page's gallery, whose
/// page view and dots would be rebuilt mid-flight).
Widget productPhotoShuttle(
  BuildContext flightContext,
  Animation<double> animation,
  HeroFlightDirection direction,
  BuildContext fromHeroContext,
  BuildContext toHeroContext,
) {
  final card = direction == HeroFlightDirection.push
      ? fromHeroContext.widget as Hero
      : toHeroContext.widget as Hero;
  return card.child;
}

/// The dish card of the home feed: one big card per row, so the client
/// discovers the dishes one by one, like a food magazine. The photo is the
/// star; the text supports it.
///
/// * Photo first, full width (4:3), a soft bottom scrim carrying the store
///   chip, and small chips on it: discount, "New", "customisable". The chips
///   are solid translucent fills with a hairline border: they look frosted
///   but cost no blur.
/// * Under it: the name (2 lines, heavy), one muted line of description,
///   and the price block (final price large, old price struck through,
///   "from" for sized dishes) with the add control.
/// * The "+" flies a thumbnail from the photo to the cart (sized dishes open
///   the product instead). Tapping the card opens the product with a Hero
///   on the photo.
/// * A closed store mutes the card: the photo is desaturated by its own
///   colour filter (no `ColorFiltered` layer) and the text dims.
/// * No photo: a warm branded plate, not a grey box.
///
/// Raster budget: one 16 px shadow on the card (light mode), one clip on the
/// photo only, no `saveLayer` at rest.
class PremiumProductCard extends StatefulWidget {
  const PremiumProductCard({
    super.key,
    required this.product,
    this.hero = true,
    this.now,
  });

  final Product product;

  /// Flies the photo to the product page. Off when another card on screen
  /// already uses this product's Hero tag.
  final bool hero;

  /// Clock override for tests ("New" badge).
  final DateTime? now;

  static const double radius = 22;
  static const double photoAspect = 4 / 3;

  /// Widest a card gets (two columns on tablets).
  static const double maxWidth = 520;

  /// A dish is "New" this long after it was added.
  static const Duration newFor = Duration(days: 14);

  /// [build] calls per product id, for the "appending a page does not
  /// rebuild the cards already built" test. Counted in debug builds only.
  @visibleForTesting
  static final Map<String, int> debugBuildCounts = {};

  @override
  State<PremiumProductCard> createState() => _PremiumProductCardState();
}

class _PremiumProductCardState extends State<PremiumProductCard> {
  /// The photo the fly-to-cart thumbnail starts from.
  final _photoKey = GlobalKey();

  @override
  Widget build(BuildContext context) {
    assert(() {
      final counts = PremiumProductCard.debugBuildCounts;
      counts[widget.product.id] = (counts[widget.product.id] ?? 0) + 1;
      return true;
    }());
    final product = widget.product;
    final dark = context.isDarkMode;
    final store = product.store;
    final closed = !product.storeIsOpen;
    final description = (product.description ?? '').trim();
    final price = product.isSized
        ? '${context.tr('jb.custom.from')} ${formatDzd(context, product.displayPrice)}'
        : formatDzd(context, product.finalPrice);
    final createdAt = product.createdAt;
    final isNew =
        createdAt != null &&
        (widget.now ?? DateTime.now()).difference(createdAt) <
            PremiumProductCard.newFor;
    const radius = Radius.circular(PremiumProductCard.radius);

    return RepaintBoundary(
      child: PressableCard(
        excludeSemantics: false,
        semanticLabel: [
          product.name,
          if (store != null) store.name,
          if (closed) context.tr('jb.store.closed'),
          price,
        ].join(', '),
        onTap: () => context.push(Routes.product(product.id), extra: product),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: dark ? AppColors.darkSurface : AppColors.white,
            borderRadius: const BorderRadius.all(radius),
            // Light: one soft, short shadow. Dark: a thin light edge instead.
            border: dark ? Border.all(color: AppColors.darkDivider) : null,
            boxShadow: dark ? null : _cardShadow,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Only the photo is clipped; the body is a plain rounded box.
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: radius),
                child: AspectRatio(
                  aspectRatio: PremiumProductCard.photoAspect,
                  child: _Photo(
                    key: _photoKey,
                    product: product,
                    hero: widget.hero,
                    isNew: isNew,
                    closed: closed,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.md,
                  AppSpacing.lg,
                  AppSpacing.lg,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ExcludeSemantics(
                      child: Text(
                        product.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.h3.copyWith(
                          color: closed ? context.textMuted : context.textMain,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          height: 1.25,
                        ),
                      ),
                    ),
                    if (description.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.xxs),
                      ExcludeSemantics(
                        child: Text(
                          description,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.body.copyWith(
                            color: context.textMuted,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.md),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: ExcludeSemantics(
                            child: PriceTag(
                              product: product,
                              style: AppTextStyles.h2.copyWith(
                                fontSize: 19,
                                height: 1.2,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
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

/// Short and soft: reads as depth without a wide blur on every card.
const List<BoxShadow> _cardShadow = [
  BoxShadow(
    color: Color(0x17000000),
    blurRadius: 16,
    spreadRadius: -4,
    offset: Offset(0, 8),
  ),
];

class _Photo extends StatelessWidget {
  const _Photo({
    super.key,
    required this.product,
    required this.hero,
    required this.isNew,
    required this.closed,
  });

  final Product product;
  final bool hero;
  final bool isNew;
  final bool closed;

  @override
  Widget build(BuildContext context) {
    final store = product.store;
    final Widget image = product.mainImage == null
        ? const _DishFallback()
        : NetImage(
            url: product.mainImage,
            media: product.mainMedia,
            placeholderIcon: Icons.restaurant_rounded,
            desaturate: closed,
          );
    return Stack(
      fit: StackFit.expand,
      children: [
        if (hero)
          Hero(
            tag: productPhotoHeroTag(product.id),
            flightShuttleBuilder: productPhotoShuttle,
            child: image,
          )
        else
          image,
        // Clear top, soft shade on the bottom 45 % for the chips.
        const IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x00000000), Color(0x8C000000)],
                stops: [0.55, 1],
              ),
            ),
          ),
        ),
        if (!product.isAvailable)
          ColoredBox(
            color: context.pageBackground.withValues(alpha: 0.55),
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
        PositionedDirectional(
          top: AppSpacing.md,
          start: AppSpacing.md,
          end: AppSpacing.md,
          child: Row(
            children: [
              if (product.hasDiscount) ...[
                _PhotoChip(
                  label: '-${product.discountPercentage.round()}%',
                  fill: AppColors.yellow,
                  foreground: AppColors.ink,
                  border: const Color(0x00000000),
                ),
                const SizedBox(width: AppSpacing.xs + 2),
              ],
              if (isNew)
                _PhotoChip(
                  label: context.tr('jb.home.new_badge'),
                  fill: const Color(0xE6FFFFFF),
                  foreground: AppColors.ink,
                  border: const Color(0x66FFFFFF),
                ),
              const Spacer(),
              InCartBadge(product: product),
            ],
          ),
        ),
        PositionedDirectional(
          start: AppSpacing.md,
          end: AppSpacing.md,
          bottom: AppSpacing.md,
          child: Row(
            children: [
              Expanded(
                child: store == null
                    ? const SizedBox.shrink()
                    : Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: _StoreChip(store: store),
                      ),
              ),
              if (product.isCustomisable) ...[
                const SizedBox(width: AppSpacing.sm),
                _PhotoChip(
                  icon: Icons.tune_rounded,
                  label: context.tr('jb.custom.customisable'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// A dish without a photo: a warm plate in the brand yellow (graphite in
/// dark mode) with a large, quiet dish mark, not a grey placeholder.
class _DishFallback extends StatelessWidget {
  const _DishFallback();

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    return DecoratedBox(
      key: const ValueKey('dish-photo-fallback'),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: dark
              ? const [AppColors.darkElevated, AppColors.darkSurface]
              : const [AppColors.yellowTint, Color(0xFFFFE883)],
        ),
      ),
      child: Align(
        alignment: const Alignment(0, -0.2),
        child: Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: dark ? const Color(0x14FFFFFF) : const Color(0x59FFFFFF),
          ),
          child: Icon(
            Icons.restaurant_rounded,
            size: 40,
            color: dark ? const Color(0x99FFD83A) : const Color(0x991E1E1E),
          ),
        ),
      ),
    );
  }
}

/// Small chip on the photo. Solid translucent fill + hairline border: the
/// frosted look of the header, without a backdrop blur per card.
class _PhotoChip extends StatelessWidget {
  const _PhotoChip({
    required this.label,
    this.icon,
    this.fill = const Color(0x8C000000),
    this.foreground = AppColors.white,
    this.border = const Color(0x33FFFFFF),
  });

  final String label;
  final IconData? icon;
  final Color fill;
  final Color foreground;
  final Color border;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm + 2,
        vertical: AppSpacing.xs + 1,
      ),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: border, width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: foreground),
            const SizedBox(width: AppSpacing.xs),
          ],
          Text(
            label,
            maxLines: 1,
            style: AppTextStyles.caption.copyWith(
              color: foreground,
              fontWeight: FontWeight.w800,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}

/// Store logo, name and open / closed dot, as a chip on the photo's scrim;
/// opens the store.
class _StoreChip extends StatelessWidget {
  const _StoreChip({required this.store});

  final ProductStore store;

  @override
  Widget build(BuildContext context) {
    final status = context.tr(
      store.isOpen ? 'jb.store.open' : 'jb.store.closed',
    );
    return Semantics(
      button: true,
      label: '${store.name}, $status',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => context.push(Routes.store(store.id)),
        child: Container(
          padding: const EdgeInsetsDirectional.fromSTEB(3, 3, 10, 3),
          decoration: BoxDecoration(
            color: const Color(0x8C000000),
            borderRadius: AppRadius.pillAll,
            border: Border.all(color: const Color(0x33FFFFFF), width: 0.5),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              StoreLogo(url: store.logo, size: 22, bordered: false),
              const SizedBox(width: AppSpacing.xs + 2),
              Flexible(
                child: Text(
                  store.isOpen ? store.name : '${store.name} · $status',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.white,
                    fontWeight: FontWeight.w700,
                    height: 1.2,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.xs + 2),
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: store.isOpen
                      ? AppColors.success
                      : const Color(0x99FFFFFF),
                  shape: BoxShape.circle,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shimmer placeholder in the card's exact frame: the 4:3 photo, a name
/// line, a description line and the price row (with the add button), so
/// nothing jumps when the dishes arrive. One shimmer for the whole card.
class PremiumProductCardSkeleton extends StatelessWidget {
  const PremiumProductCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    const radius = Radius.circular(PremiumProductCard.radius);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurface : AppColors.white,
        borderRadius: const BorderRadius.all(radius),
        border: Border.all(color: context.fieldBorder),
      ),
      child: const AppSkeletonGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.vertical(top: radius),
              child: AspectRatio(
                aspectRatio: PremiumProductCard.photoAspect,
                child: AppSkeleton(height: double.infinity, radius: 0),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.lg,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppSkeleton(width: 220, height: 20),
                  SizedBox(height: AppSpacing.sm),
                  AppSkeleton(width: 180, height: 14),
                  SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      AppSkeleton(width: 96, height: 22),
                      Spacer(),
                      AppSkeleton(width: 40, height: 40, radius: 20),
                    ],
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
