import 'dart:ui' show ImageFilter;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart'
    show OverScrollHeaderStretchConfiguration;
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/logo/debvora_logo.dart';
import '../../../core/components/widgets/net_image.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/paginated.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/router/routes.dart';
import '../../../core/service/api_result.dart';
import '../../cart/data/models/cart_line.dart';
import '../../cart/logic/cart_cubit.dart';
import '../../cart/ui/widgets/cart_flight.dart';
import '../../cart/ui/widgets/cart_icon_button.dart';
import '../data/models/product.dart';
import '../data/models/product_query.dart';
import '../data/repo/catalog_repository.dart';
import 'widgets/expandable_text.dart';
import 'widgets/load_state_view.dart';
import 'widgets/product_card.dart';
import 'widgets/premium_product_card.dart';
import 'widgets/product_customizer.dart';
import 'widgets/store_tile.dart';
import '../../../core/network/image_url.dart';

/// `GET /products/:id` — gallery, price, description, the
/// [ProductCustomizer] (sizes / supplements / instructions), store and
/// related items, with a sticky "Add to cart · total" bar for every product.
/// [editLine] reopens it pre-filled to update a cart line.
class ProductDetailsScreen extends StatelessWidget {
  const ProductDetailsScreen({
    super.key,
    required this.productId,
    this.editLine,
    this.preview,
  });

  final String productId;
  final CartLine? editLine;

  /// The list's copy of the product (opened from a premium card): its photo
  /// shows while the full product loads, so the card's Hero has a target.
  final Product? preview;

  @override
  Widget build(BuildContext context) {
    final catalog = getIt<CatalogRepository>();
    return BlocProvider(
      create: (_) =>
          LoadCubit<Product>(() => catalog.getProduct(productId))..load(),
      child: BlocBuilder<LoadCubit<Product>, LoadState<Product>>(
        builder: (context, state) =>
            _ProductPage(state: state, editLine: editLine, preview: preview),
      ),
    );
  }
}

class _ProductPage extends StatefulWidget {
  const _ProductPage({required this.state, this.editLine, this.preview});

  final LoadState<Product> state;
  final CartLine? editLine;
  final Product? preview;

  @override
  State<_ProductPage> createState() => _ProductPageState();
}

class _ProductPageState extends State<_ProductPage> {
  CustomisationController? _controller;

  /// 0 while the large title is visible, 1 once it went under the bar:
  /// drives the compact title (and fades the large one out).
  final _titleProgress = ValueNotifier<double>(0);
  final _titleKey = GlobalKey();

  bool _onScroll(ScrollNotification n) {
    if (n.depth != 0 || n.metrics.axis != Axis.vertical) return false;
    _updateTitle();
    return false;
  }

  /// Measures the large title against the bottom of the bar, so a two-line
  /// name or a bigger text size hands over at the right moment.
  void _updateTitle() {
    final box = _titleKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize || !box.attached) return;
    final barBottom = MediaQuery.paddingOf(context).top + kToolbarHeight;
    final titleBottom = box.localToGlobal(Offset(0, box.size.height)).dy;
    // Starts when the title's last line reaches the bar, done 28 pt later.
    _titleProgress.value = ((barBottom + 28 - titleBottom) / 28).clamp(
      0.0,
      1.0,
    );
  }

  /// One controller per loaded product, kept across rebuilds (a reload keeps
  /// the client's choices only when it is the same product). Plain products
  /// use it too: no choices, just the quantity and the total.
  CustomisationController? _controllerFor(Product? product) {
    if (product == null) return null;
    if (_controller?.product.id != product.id) {
      _controller?.dispose();
      _controller = CustomisationController(product, editing: widget.editLine);
    }
    return _controller;
  }

  @override
  void dispose() {
    _controller?.dispose();
    _titleProgress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final product = state.data;
    final controller = _controllerFor(product);
    final preview = widget.preview;
    if (product == null && preview != null && state.error == null) {
      return _PreviewPage(product: preview, titleProgress: _titleProgress);
    }
    if (product == null) {
      return Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          leadingWidth: AppSpacing.screenH + 46,
          leading: Center(
            child: AppRoundIconButton(
              icon: Icons.adaptive.arrow_back_rounded,
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              onPressed: () => context.pop(),
            ),
          ),
          actions: const [
            CartIconButton(),
            SizedBox(width: AppSpacing.md),
          ],
        ),
        body: LoadStateView<Product>(
          state: state,
          onRetry: context.read<LoadCubit<Product>>().load,
          builder: (_, _) => const SizedBox.shrink(),
        ),
      );
    }
    final screen = MediaQuery.sizeOf(context);
    final topInset = MediaQuery.paddingOf(context).top;
    final wide = screen.width >= Breakpoints.tablet;
    final header = ProductPhotoHeaderDelegate(
      product: product,
      topInset: topInset,
      expandedHeight: screen.height * (wide ? 0.4 : 0.46),
      titleProgress: _titleProgress,
    );
    return Scaffold(
      body: NotificationListener<ScrollNotification>(
        onNotification: _onScroll,
        child: CustomScrollView(
          // Bouncing on every platform: the photo stretches on pull-down.
          physics: const BouncingScrollPhysics(
            parent: AlwaysScrollableScrollPhysics(),
          ),
          slivers: [
            SliverPersistentHeader(pinned: true, delegate: header),
            SliverToBoxAdapter(
              child: _Details(
                product: product,
                controller: controller,
                titleKey: _titleKey,
                titleProgress: _titleProgress,
              ),
            ),
            // A short page can still scroll its large title under the bar,
            // so the compact title always takes over the same way.
            SliverLayoutBuilder(
              builder: (context, constraints) {
                // Store chip + a two-line title, with some margin.
                const titleZone = 180.0;
                final details =
                    constraints.precedingScrollExtent - header.maxExtent;
                final needed =
                    constraints.viewportMainAxisExtent -
                    header.minExtent +
                    titleZone -
                    details;
                return SliverToBoxAdapter(
                  child: SizedBox(height: needed > 0 ? needed : 0),
                );
              },
            ),
          ],
        ),
      ),
      bottomNavigationBar: controller == null
          ? null
          : _AddBar(controller: controller),
    );
  }
}

/// The photo header from the list's copy of the product and a loader,
/// while `GET /products/:id` is on its way.
class _PreviewPage extends StatelessWidget {
  const _PreviewPage({required this.product, required this.titleProgress});

  final Product product;
  final ValueListenable<double> titleProgress;

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final wide = screen.width >= Breakpoints.tablet;
    return Scaffold(
      body: CustomScrollView(
        physics: const NeverScrollableScrollPhysics(),
        slivers: [
          SliverPersistentHeader(
            pinned: true,
            delegate: ProductPhotoHeaderDelegate(
              product: product,
              topInset: MediaQuery.paddingOf(context).top,
              expandedHeight: screen.height * (wide ? 0.4 : 0.46),
              titleProgress: titleProgress,
            ),
          ),
          const SliverFillRemaining(
            hasScrollBody: false,
            child: Center(child: AppLoader(size: 48)),
          ),
        ],
      ),
    );
  }
}

/// Collapsing photo header of the product page.
///
/// Expanded: the photo (gallery with dots) under round back / cart buttons,
/// stretching and zooming on pull-down, moving at half speed on scroll
/// (parallax), with the page's rounded sheet starting [lip] pt over it.
/// Collapsed: an iOS-style translucent blurred bar; the buttons become
/// plain icons and the product name fades in, centred, once the large title
/// has scrolled under the bar.
class ProductPhotoHeaderDelegate extends SliverPersistentHeaderDelegate {
  ProductPhotoHeaderDelegate({
    required this.product,
    required this.topInset,
    required this.expandedHeight,
    required this.titleProgress,
  });

  final Product product;
  final double topInset;
  final double expandedHeight;
  final ValueListenable<double> titleProgress;

  /// Height of the sheet's rounded edge over the photo.
  static const double lip = AppSpacing.xl;

  @override
  double get maxExtent =>
      expandedHeight < minExtent + 160 ? minExtent + 160 : expandedHeight;

  @override
  double get minExtent => topInset + kToolbarHeight;

  @override
  OverScrollHeaderStretchConfiguration get stretchConfiguration =>
      OverScrollHeaderStretchConfiguration();

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlaps) {
    final range = maxExtent - minExtent;
    // 0 = expanded, 1 = collapsed.
    final t = (shrinkOffset / range).clamp(0.0, 1.0);
    final bar = ((t - 0.75) / 0.25).clamp(0.0, 1.0);
    final page = context.pageBackground;
    final lipHeight = lip * (1 - t);
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.maxHeight;
        return Stack(
          fit: StackFit.expand,
          children: [
            // Photo, laid out once at the expanded size (decoded once) and
            // scaled to cover: zooms when stretched, crops when collapsing,
            // and moves at half the scroll speed.
            Positioned(
              top: -shrinkOffset * 0.5,
              left: 0,
              right: 0,
              height: height + shrinkOffset * 0.5,
              child: Opacity(
                opacity: 1 - bar,
                child: ClipRect(
                  child: FittedBox(
                    fit: BoxFit.cover,
                    child: SizedBox(
                      width: constraints.maxWidth,
                      height: maxExtent,
                      child: Hero(
                        tag: productPhotoHeroTag(product.id),
                        flightShuttleBuilder: productPhotoShuttle,
                        child: _Gallery(
                          product: product,
                          dotsBottom: lip + AppSpacing.md,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            // Keeps the round buttons and the status bar readable.
            IgnorePointer(
              child: Opacity(
                opacity: 1 - bar,
                child: Align(
                  alignment: Alignment.topCenter,
                  child: Container(
                    height: topInset + kToolbarHeight + 24,
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Color(0x40000000), Color(0x00000000)],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            // The sheet's rounded top edge, overlapping the photo.
            Positioned(
              left: 0,
              right: 0,
              bottom: -0.5,
              height: lipHeight + 1,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: page,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(AppRadius.xl),
                  ),
                ),
              ),
            ),
            if (bar > 0)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: minExtent,
                child: Opacity(
                  opacity: bar,
                  child: ClipRect(
                    child: BackdropFilter(
                      filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: page.withValues(alpha: 0.82),
                          border: Border(
                            bottom: BorderSide(
                              color: context.fieldBorder.withValues(
                                alpha: titleProgress.value,
                              ),
                              width: 0.5,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            Positioned(
              top: topInset,
              left: 0,
              right: 0,
              height: kToolbarHeight,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                child: Row(
                  children: [
                    _BarButton(
                      icon: Icons.adaptive.arrow_back_rounded,
                      tooltip: MaterialLocalizations.of(
                        context,
                      ).backButtonTooltip,
                      discOpacity: 1 - bar,
                      onPressed: () => context.pop(),
                    ),
                    Expanded(
                      child: ValueListenableBuilder<double>(
                        valueListenable: titleProgress,
                        builder: (context, p, _) => ExcludeSemantics(
                          excluding: p < 0.5,
                          child: Opacity(
                            opacity: p,
                            child: Transform.translate(
                              offset: Offset(0, 6 * (1 - p)),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: AppSpacing.sm,
                                ),
                                child: Text(
                                  product.name,
                                  key: const ValueKey('compact-title'),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  textAlign: TextAlign.center,
                                  style: AppTextStyles.h3.copyWith(
                                    color: context.textMain,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    CartIconButton(discOpacity: 1 - bar),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  @override
  bool shouldRebuild(ProductPhotoHeaderDelegate old) =>
      old.product != product ||
      old.topInset != topInset ||
      old.expandedHeight != expandedHeight ||
      old.titleProgress != titleProgress;
}

/// Round button on the photo that turns into a plain icon in the bar.
class _BarButton extends StatelessWidget {
  const _BarButton({
    required this.icon,
    required this.tooltip,
    required this.discOpacity,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final double discOpacity;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    final disc = dark ? AppColors.darkSurface : AppColors.white;
    final edge = dark ? AppColors.darkDivider : AppColors.divider;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: disc.withValues(alpha: discOpacity),
        shape: CircleBorder(
          side: BorderSide(color: edge.withValues(alpha: discOpacity)),
        ),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: 46,
            height: 46,
            child: Icon(icon, size: 22, color: context.textMain),
          ),
        ),
      ),
    );
  }
}

/// The title card (the sheet over the photo) and everything under it.
class _Details extends StatelessWidget {
  const _Details({
    required this.product,
    required this.titleKey,
    required this.titleProgress,
    this.controller,
  });

  final Product product;
  final CustomisationController? controller;
  final GlobalKey titleKey;
  final ValueListenable<double> titleProgress;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screenH,
            0,
            AppSpacing.screenH,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (product.store != null) ...[
                _StoreChip(store: product.store!),
                const SizedBox(height: AppSpacing.xs),
              ],
              ValueListenableBuilder<double>(
                valueListenable: titleProgress,
                builder: (context, p, child) =>
                    Opacity(opacity: 1 - p, child: child),
                child: Semantics(
                  header: true,
                  child: Text(
                    product.name,
                    key: titleKey,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.display.copyWith(
                      fontSize: 28,
                      height: 1.2,
                      color: context.textMain,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              _PriceLine(product: product),
              _QuickInfo(product: product),
              if (!product.isAvailable)
                _StatusLine(
                  icon: Icons.block_rounded,
                  message: context.tr('jb.product.unavailable'),
                )
              else if (product.stock != null && product.stock! <= 5)
                _StatusLine(
                  icon: Icons.inventory_2_outlined,
                  message: context.tr(
                    'jb.product.low_stock',
                    args: {'count': product.stock!},
                  ),
                ),
              if ((product.description ?? '').isNotEmpty) ...[
                const SizedBox(height: AppSpacing.lg),
                ExpandableText(
                  product.description!,
                  maxLines: 3,
                  moreKey: 'jb.store.more',
                  lessKey: 'jb.store.less',
                ),
              ],
              if (controller != null && product.isCustomisable)
                ProductCustomizer(controller: controller!, animateIn: true),
            ],
          ),
        ),
        _Related(product: product),
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }
}

/// Small tappable store chip above the title; opens the store.
class _StoreChip extends StatelessWidget {
  const _StoreChip({required this.store});

  final ProductStore store;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: context.tr('jb.product.open_store', args: {'name': store.name}),
      excludeSemantics: true,
      child: InkWell(
        key: const ValueKey('store-chip'),
        onTap: () => context.push(Routes.store(store.id)),
        borderRadius: AppRadius.pillAll,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              StoreLogo(url: store.logo, size: 24),
              const SizedBox(width: AppSpacing.sm),
              Flexible(
                child: Text(
                  store.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.label.copyWith(color: context.textMuted),
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: context.textFaint,
                textDirection: Directionality.of(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Category, "Customisable" and the selling step, as quiet pills.
class _QuickInfo extends StatelessWidget {
  const _QuickInfo({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final category = product.category;
    final pills = <(IconData?, String, String)>[
      if (category != null && category.name.isNotEmpty)
        (null, category.icon, category.name),
      if (product.isCustomisable)
        (Icons.tune_rounded, '', context.tr('jb.product.customisable')),
      if (product.unit != 'piece')
        (
          Icons.scale_outlined,
          '',
          context.tr(
            'jb.product.sold_by',
            args: {'step': formatQty(context, product.unitStep, product.unit)},
          ),
        ),
    ];
    if (pills.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          for (final (icon, emoji, label) in pills)
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.xs + 2,
              ),
              decoration: BoxDecoration(
                color: context.fieldFill,
                borderRadius: AppRadius.pillAll,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null)
                    Icon(icon, size: 15, color: context.textMuted)
                  else if (emoji.isNotEmpty)
                    Text(emoji, style: const TextStyle(fontSize: 13)),
                  if (icon != null || emoji.isNotEmpty)
                    const SizedBox(width: AppSpacing.xs + 2),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.label.copyWith(
                        color: context.textMain,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Price ("From" when sized), the old price and the discount, and the
/// selling step of weighed products.
class _PriceLine extends StatelessWidget {
  const _PriceLine({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final perUnit = product.unit == 'piece'
        ? null
        : '/ ${context.tr('jb.unit.${product.unit}')}';
    final muted = AppTextStyles.body.copyWith(color: context.textMuted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.xs,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  if (product.isSized)
                    TextSpan(
                      text: '${context.tr('jb.custom.from')} ',
                      style: muted,
                    ),
                  TextSpan(
                    text: formatDzd(context, product.displayPrice),
                    style: AppTextStyles.h2.copyWith(color: context.textMain),
                  ),
                  if (perUnit != null)
                    TextSpan(text: ' $perUnit', style: muted),
                ],
              ),
            ),
            if (product.hasDiscount) ...[
              Text(
                formatDzd(context, product.displayOriginalPrice),
                style: muted.copyWith(decoration: TextDecoration.lineThrough),
              ),
              DiscountBadge(percent: product.discountPercentage),
            ],
          ],
        ),
      ],
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.warning),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTextStyles.label.copyWith(color: context.textMain),
            ),
          ),
        ],
      ),
    );
  }
}

/// The product photos: one image, a swipeable gallery with dots, or the
/// branded placeholder when there is no photo.
class _Gallery extends StatefulWidget {
  const _Gallery({required this.product, required this.dotsBottom});

  final Product product;

  /// Distance of the dots from the bottom (above the sheet's edge).
  final double dotsBottom;

  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final images = widget.product.images
        .where((i) => i.url.isNotEmpty || i.media != null)
        .toList();
    if (images.isEmpty) return const _PhotoPlaceholder();
    return Stack(
      fit: StackFit.expand,
      children: [
        if (images.length == 1)
          NetImage(
            url: images.first.url,
            media: images.first.media,
            size: ImageSize.large,
          )
        else
          PageView.builder(
            itemCount: images.length,
            onPageChanged: (i) => setState(() => _page = i),
            itemBuilder: (_, i) => NetImage(
              url: images[i].url,
              media: images[i].media,
              size: ImageSize.large,
            ),
          ),
        // Subtle bottom shade so the dots and the sheet edge sit softly.
        const IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x00000000), Color(0x2E000000)],
                stops: [0.6, 1],
              ),
            ),
          ),
        ),
        if (images.length > 1)
          Positioned(
            left: 0,
            right: 0,
            bottom: widget.dotsBottom,
            child: Semantics(
              label: context.tr(
                'jb.custom.photo',
                args: {'index': _page + 1, 'count': images.length},
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < images.length; i++)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: i == _page ? 18 : 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: AppColors.white.withValues(
                          alpha: i == _page ? 1 : 0.6,
                        ),
                        borderRadius: AppRadius.pillAll,
                        boxShadow: AppShadows.card,
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// No photo yet: the Jibli mark on a soft brand tint, never an empty box.
class _PhotoPlaceholder extends StatelessWidget {
  const _PhotoPlaceholder();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      key: const ValueKey('photo-placeholder'),
      color: context.isDarkMode ? AppColors.darkSurface : AppColors.accentTint,
      child: const Center(
        child: Opacity(opacity: 0.9, child: DebvoraWordmark(size: 96)),
      ),
    );
  }
}

/// Same-category products (minus this one), horizontally.
class _Related extends StatefulWidget {
  const _Related({required this.product});

  final Product product;

  @override
  State<_Related> createState() => _RelatedState();
}

class _RelatedState extends State<_Related> {
  late final Future<ApiResult<Paginated<Product>>> _future =
      getIt<CatalogRepository>().getProducts(
        ProductQuery(categoryId: widget.product.categoryId, limit: 10),
      );

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: _future,
      builder: (context, snapshot) {
        final result = snapshot.data;
        if (result is! Success<Paginated<Product>>) {
          return const SizedBox.shrink();
        }
        final related = result.data.items
            .where((p) => p.id != widget.product.id)
            .toList();
        if (related.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenH,
                AppSpacing.xl,
                AppSpacing.screenH,
                AppSpacing.sm,
              ),
              child: AppSectionHeader(title: context.tr('jb.product.related')),
            ),
            SizedBox(
              height: 270,
              child: ListView.separated(
                padding: AppSpacing.screen,
                scrollDirection: Axis.horizontal,
                itemCount: related.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(width: AppSpacing.md),
                itemBuilder: (_, i) => SizedBox(
                  width: 165,
                  child: ProductCard(product: related[i]),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Sticky bottom bar: quantity + "Add to cart · total". After adding, the
/// screen stays open with the choices reset (to add the same dish with
/// other choices) and a "View cart (n)" link; editing a cart line saves and
/// goes back to the cart.
class _AddBar extends StatelessWidget {
  const _AddBar({required this.controller});

  final CustomisationController controller;

  @override
  Widget build(BuildContext context) {
    final product = controller.product;
    final ordering = context.select<CartCubit, bool>(
      (c) => c.state.orderingEnabled,
    );
    final (lines, inCart) = context.select<CartCubit, (int, bool)>(
      (c) => (c.state.lineCount, c.state.qtyOf(product.id) > 0),
    );
    final editing = controller.editingKey != null;
    final String? blocked = !ordering
        ? context.tr('jb.home.closed_message')
        : !product.storeIsOpen
        ? context.tr('jb.custom.store_closed')
        : !product.isAvailable
        ? context.tr('jb.product.unavailable')
        : null;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.sm,
        AppSpacing.screenH,
        AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: context.pageBackground,
        border: Border(top: BorderSide(color: context.fieldBorder, width: 0.5)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (inCart && !editing)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton.icon(
                  key: const ValueKey('view-cart'),
                  onPressed: () => context.push(Routes.cart),
                  icon: const Icon(Icons.shopping_bag_outlined, size: 18),
                  label: Text(
                    context.tr('jb.custom.view_cart', args: {'count': lines}),
                  ),
                ),
              ),
            Builder(
              builder: (bar) => CustomizerAddBar(
                controller: controller,
                enabled: blocked == null,
                disabledReason: blocked,
                onAdd: () {
                  final cart = context.read<CartCubit>();
                  final line = controller.toLine();
                  if (editing) {
                    cart.addLine(
                      product,
                      line,
                      replacing: controller.editingKey,
                    );
                    if (context.canPop()) context.pop();
                    return;
                  }
                  // The thumbnail flies from the add bar to the header's cart
                  // icon, which pops on impact: no snackbar on top of it.
                  CartFlight.add(
                    bar,
                    product: product,
                    imageSize: ImageSize.large,
                    commit: () => cart.addLine(product, line),
                  );
                  controller.reset();
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
