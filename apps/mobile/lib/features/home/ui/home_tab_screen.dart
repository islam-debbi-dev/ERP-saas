import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/net_image.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/paginated.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../../core/perf/app_perf.dart';
import '../../../core/router/routes.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/session/session_state.dart';
import '../../cart/logic/cart_cubit.dart';
import '../../cart/ui/widgets/cart_icon_button.dart';
import '../../catalog/data/models/home_feed.dart';
import '../../catalog/data/models/product.dart';
import '../../catalog/data/models/product_query.dart';
import '../../catalog/data/repo/catalog_repository.dart';
import '../../catalog/ui/product_list_screen.dart';
import '../../catalog/ui/widgets/category_bubble.dart';
import '../../catalog/ui/widgets/paged_product_slivers.dart';
import '../../catalog/ui/widgets/product_card.dart';
import '../../catalog/ui/widgets/store_tile.dart';
import '../logic/home_feed_cubit.dart';
import '../logic/random_products_cubit.dart';
import 'widgets/call_to_order.dart';

/// Tab 1 — the food feed: craving categories (fast food first), food deals,
/// restaurants and an infinite "Popular dishes" feed of premium cards. Groceries live in the
/// Fruits & Vegetables and Supermarket tabs.
class HomeTabScreen extends StatelessWidget {
  const HomeTabScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final catalog = getIt<CatalogRepository>();
    return MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (_) => HomeFeedCubit(catalog, getIt<CartCubit>())..load(),
        ),
        // Fed once `/home` tells us which food categories exist.
        BlocProvider(create: (_) => PagedCubit<Product>(_noProducts)),
        // Random fast food after the last page of "Popular dishes".
        BlocProvider(create: (_) => RandomProductsCubit(catalog)),
      ],
      child: const _HomeView(),
    );
  }
}

Future<ApiResult<Paginated<Product>>> _noProducts(int page) async =>
    const ApiResult.success(
      Paginated(items: [], page: 1, limit: 20, total: 0, totalPages: 0),
    );

/// "Popular dishes" loaded its last page without error: the feed may
/// continue with random fast food.
bool _reachedEnd(PagedState<Product> s) =>
    s.status == PagedStatus.ready &&
    !s.hasMore &&
    !s.loadingMore &&
    s.error == null &&
    s.items.isNotEmpty;

class _HomeView extends StatelessWidget {
  const _HomeView();

  /// Points the dish feed at the food categories of the latest feed, and
  /// puts the fast-food continuation back to idle (pull-to-refresh: it
  /// starts again, with a new seed, once the dishes end again).
  void _syncDishes(BuildContext context, HomeFeedState state) {
    final ids = state.foodCategoryIds.toList();
    final catalog = getIt<CatalogRepository>();
    context.read<RandomProductsCubit>().clear();
    context.read<PagedCubit<Product>>().reset(
      ids.isEmpty
          ? _noProducts
          : (page) =>
                catalog.getProducts(ProductQuery(page: page, categoryIds: ids)),
    );
  }

  /// Starts the random fast food as soon as the last dishes page is in
  /// (before the user reaches it, so there is no visible wait).
  void _startFastFood(BuildContext context, PagedState<Product> _) {
    final random = context.read<RandomProductsCubit>();
    if (random.started) return;
    random.start(context.read<HomeFeedCubit>().state.fastFoodCategoryIds);
  }

  /// Decodes the first random photos while the user is still on the
  /// dishes above.
  void _precacheFirst(BuildContext context, PagedState<Product> state) {
    final slot = premiumPhotoSize(MediaQuery.sizeOf(context).width);
    for (final p in state.items.take(3)) {
      if (p.mainImage == null) continue;
      NetImage.precache(
        context,
        url: p.mainImage,
        media: p.mainMedia,
        slotSize: slot,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final feedCubit = context.read<HomeFeedCubit>();
    final products = context.read<PagedCubit<Product>>();
    final random = context.read<RandomProductsCubit>();
    final topInset = MediaQuery.paddingOf(context).top;

    // Scrolling near the end loads the list that is still growing.
    void loadMore() =>
        products.state.hasMore ? products.loadMore() : random.loadMore();

    return MultiBlocListener(
      listeners: [
        BlocListener<HomeFeedCubit, HomeFeedState>(
          listenWhen: (prev, next) =>
              next.feed != null && prev.feed != next.feed,
          listener: _syncDishes,
        ),
        BlocListener<PagedCubit<Product>, PagedState<Product>>(
          listenWhen: (prev, next) => !_reachedEnd(prev) && _reachedEnd(next),
          listener: _startFastFood,
        ),
        BlocListener<RandomProductsCubit, PagedState<Product>>(
          listenWhen: (prev, next) =>
              prev.items.isEmpty && next.items.isNotEmpty,
          listener: _precacheFirst,
        ),
      ],
      child: Scaffold(
        body: _CallToOrderLayer(
          child: SafeArea(
            top: false,
            bottom: false,
            // One backdrop pass for the header and the status-bar strip
            // (both blur the same scrolling content).
            child: BackdropGroup(
              child: Stack(
                children: [
                  RefreshIndicator(
                    onRefresh: feedCubit.load,
                    child: LoadMoreListener(
                      onLoadMore: loadMore,
                      child: CustomScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        slivers: [
                          const _FloatingAppBar(),
                          BlocBuilder<HomeFeedCubit, HomeFeedState>(
                            // Not on the cart / session changes the
                            // sections read themselves.
                            buildWhen: (prev, next) =>
                                prev.feed != next.feed ||
                                prev.config != next.config ||
                                prev.loading != next.loading ||
                                prev.error != next.error,
                            builder: (context, state) =>
                                HomeFeedSections(state: state),
                          ),
                          SliverPadding(
                            padding: const EdgeInsets.fromLTRB(
                              AppSpacing.screenH,
                              AppSpacing.xl,
                              AppSpacing.screenH,
                              AppSpacing.md,
                            ),
                            sliver: SliverToBoxAdapter(
                              child: AppSectionHeader(
                                title: context.tr('jb.home.popular_dishes'),
                              ),
                            ),
                          ),
                          BlocBuilder<PagedCubit<Product>, PagedState<Product>>(
                            // One premium card per row: the dishes are
                            // discovered one by one, like a food magazine.
                            builder: (context, state) => PagedProductList(
                              state: state,
                              onRetry: products.refresh,
                              onLoadMore: products.loadMore,
                              emptyTitle: context.tr('jb.home.no_food_title'),
                              emptyMessage: context.tr(
                                'jb.home.no_food_message',
                              ),
                            ),
                          ),
                          BlocBuilder<RandomProductsCubit, PagedState<Product>>(
                            builder: (context, state) => _FastFoodSection(
                              state: state,
                              onLoadMore: random.loadMore,
                            ),
                          ),
                          SliverToBoxAdapter(child: SizedBox(height: 200.h)),
                        ],
                      ),
                    ),
                  ),
                  // Keeps the status bar legible when an iOS bounce pulls
                  // the header down. It shares the header's backdrop pass.
                  PositionedDirectional(
                    top: 0,
                    start: 0,
                    end: 0,
                    height: topInset,
                    child: const _FrostedBackground(),
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

/// "More fast food for you": random fast-food dishes after the last page of
/// "Popular dishes", same cards and infinite scroll. Hidden while it has no
/// dish (idle, or the query found none).
class _FastFoodSection extends StatelessWidget {
  const _FastFoodSection({required this.state, required this.onLoadMore});

  final PagedState<Product> state;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    // The dishes above already show these products with their Hero.
    final above = {
      for (final p in context.read<PagedCubit<Product>>().state.items) p.id,
    };
    return PagedProductList(
      key: const ValueKey('fast-food-feed'),
      state: state,
      onRetry: onLoadMore,
      onLoadMore: onLoadMore,
      collapseWhenEmpty: true,
      hasHero: (p) => !above.contains(p.id),
      header: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.screenH,
          AppSpacing.lg,
          AppSpacing.screenH,
          AppSpacing.md,
        ),
        child: AppSectionHeader(title: context.tr('jb.home.more_fast_food')),
      ),
    );
  }
}

/// Feeds the admin's order phones into the floating call button.
class _CallToOrderLayer extends StatelessWidget {
  const _CallToOrderLayer({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<HomeFeedCubit>().state;
    return CallToOrderOverlay(
      phones: state.orderPhones,
      closed: state.closedMessage != null,
      child: child,
    );
  }
}

/// Pinned header row with a search bar that hides while scrolling down and
/// slides back in, over the content, as soon as the user scrolls up a little.
class _FloatingAppBar extends StatefulWidget {
  const _FloatingAppBar();

  @override
  State<_FloatingAppBar> createState() => _FloatingAppBarState();
}

class _FloatingAppBarState extends State<_FloatingAppBar>
    with TickerProviderStateMixin {
  /// Real height of [_Header]; it varies with the shop name, the address line
  /// and the text scale, so it is measured rather than hard-coded. The initial
  /// value is only a first-frame estimate.
  double _headerHeight = 110;

  void _onHeaderSize(Size size) {
    if (size.height == _headerHeight) return;
    setState(() => _headerHeight = size.height);
  }

  @override
  Widget build(BuildContext context) {
    return SliverPersistentHeader(
      pinned: true,
      floating: true,
      delegate: _AppBarDelegate(
        topInset: MediaQuery.paddingOf(context).top,
        headerHeight: _headerHeight,
        onHeaderSize: _onHeaderSize,
        vsync: this,
      ),
    );
  }
}

class _AppBarDelegate extends SliverPersistentHeaderDelegate {
  _AppBarDelegate({
    required this.topInset,
    required this.headerHeight,
    required this.onHeaderSize,
    required this.vsync,
  });

  /// [_SearchField] height plus its bottom gap.
  static const double _searchBand = 50 + AppSpacing.sm;

  final double topInset;
  final double headerHeight;
  final ValueChanged<Size> onHeaderSize;

  @override
  final TickerProvider vsync;

  @override
  double get minExtent => topInset + headerHeight;

  @override
  double get maxExtent => minExtent + _searchBand;

  @override
  FloatingHeaderSnapConfiguration get snapConfiguration =>
      FloatingHeaderSnapConfiguration(
        curve: Curves.easeOutCubic,
        duration: const Duration(milliseconds: 220),
      );

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlaps) {
    // 1 = search fully shown, 0 = fully tucked under the header.
    final shown = (1 - shrinkOffset / _searchBand).clamp(0.0, 1.0);
    return _FrostedBackground(
      // Nothing to blur until the feed scrolls under the header.
      blur: overlaps || shrinkOffset > 0,
      child: Stack(
        clipBehavior: Clip.hardEdge,
        children: [
          // Revealed from under the header and clipped to the space below
          // it, so it never shows through the header row mid-animation.
          PositionedDirectional(
            start: 0,
            end: 0,
            top: minExtent,
            bottom: 0,
            child: ClipRect(
              child: OverflowBox(
                alignment: AlignmentDirectional.bottomCenter,
                minHeight: _searchBand,
                maxHeight: _searchBand,
                child: Opacity(
                  opacity: shown,
                  child: const Padding(
                    padding: EdgeInsets.only(bottom: AppSpacing.sm),
                    child: _SearchField(),
                  ),
                ),
              ),
            ),
          ),
          PositionedDirectional(
            start: 0,
            end: 0,
            top: 0,
            child: Padding(
              // Top safe area is off for the screen, so the header reserves
              // the status bar itself and its blur runs edge to edge.
              padding: EdgeInsets.only(top: topInset),
              child: _MeasureSize(
                onChange: onHeaderSize,
                child: const _Header(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(_AppBarDelegate old) =>
      old.topInset != topInset ||
      old.headerHeight != headerHeight ||
      old.vsync != vsync;
}

/// Reports its child's laid-out size after the frame.
class _MeasureSize extends SingleChildRenderObjectWidget {
  const _MeasureSize({required this.onChange, required super.child});

  final ValueChanged<Size> onChange;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderMeasureSize(onChange);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderMeasureSize renderObject,
  ) => renderObject.onChange = onChange;
}

class _RenderMeasureSize extends RenderProxyBox {
  _RenderMeasureSize(this.onChange);

  ValueChanged<Size> onChange;
  Size? _last;

  @override
  void performLayout() {
    super.performLayout();
    if (size == _last) return;
    _last = size;
    final reported = size;
    WidgetsBinding.instance.addPostFrameCallback((_) => onChange(reported));
  }
}

/// Page-coloured surface shared by the header and the status bar strip so
/// they read as one.
///
/// Where [AppPerf.useBlur] allows it (iPhone), a translucent fill over a
/// grouped σ12 blur of the content scrolling under it. Elsewhere (Android)
/// the same colour, near opaque, with no backdrop pass: a live blur pinned
/// over a scrolling list costs the raster thread every frame.
class _FrostedBackground extends StatelessWidget {
  const _FrostedBackground({this.child, this.blur = true});

  final Widget? child;

  /// `false` while nothing is under the surface (top of the feed).
  final bool blur;

  @override
  Widget build(BuildContext context) {
    final content = child ?? const SizedBox.expand();
    if (!AppPerf.useBlur(context)) {
      return ColoredBox(
        key: const ValueKey('home-header-solid'),
        color: context.pageBackground.withValues(alpha: 0.97),
        child: content,
      );
    }
    return ClipRect(
      child: BackdropFilter.grouped(
        key: const ValueKey('home-header-blur'),
        enabled: blur,
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: ColoredBox(
          color: context.pageBackground.withValues(alpha: 0.85),
          child: content,
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    final shopName = context.select<HomeFeedCubit, String>(
      (c) => c.state.feed?.shopName ?? '',
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.md,
        AppSpacing.screenH,
        AppSpacing.md,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (shopName.isNotEmpty)
                  Text(
                    shopName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                Text(
                  context.tr('jb.home.craving'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                const SizedBox(height: AppSpacing.xs),
                const _AddressChip(),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          const CartIconButton(),
        ],
      ),
    );
  }
}

/// "Deliver to" chip with the default address — opens the address book (or login).
class _AddressChip extends StatelessWidget {
  const _AddressChip();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionCubit>().state;
    final address = session.user?.defaultAddress;
    final label = switch (session.status) {
      SessionStatus.authenticated when address != null =>
        address.label.isEmpty
            ? address.fullAddress
            : '${address.label} · ${address.fullAddress}',
      SessionStatus.authenticated => context.tr('jb.address.add'),
      _ => context.tr('jb.home.sign_in_for_delivery'),
    };
    return InkWell(
      borderRadius: AppRadius.pillAll,
      onTap: () => context.push(
        session.isAuthenticated ? Routes.addresses : Routes.login,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.location_on_rounded,
              size: 16,
              color: AppColors.accentDeep,
            ),
            const SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.caption.copyWith(color: context.textMuted),
              ),
            ),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 18,
              color: context.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}

/// Read-only search box; the real input lives on the search screen.
class _SearchField extends StatelessWidget {
  const _SearchField();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: AppSpacing.screen,
      child: Material(
        color: context.fieldFill,
        borderRadius: AppRadius.mdAll,
        child: InkWell(
          borderRadius: AppRadius.mdAll,
          onTap: () => context.push(
            Routes.search,
            extra: ProductListArgs.search(
              context.tr('jb.search.title'),
              categoryIds: context
                  .read<HomeFeedCubit>()
                  .state
                  .foodCategoryIds
                  .toList(),
              hint: context.tr('jb.search.food_hint'),
            ),
          ),
          child: Container(
            height: 50,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            decoration: BoxDecoration(
              borderRadius: AppRadius.mdAll,
              border: Border.all(color: context.fieldBorder),
            ),
            child: Row(
              children: [
                Icon(Icons.search_rounded, color: context.textFaint),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    context.tr('jb.search.food_hint'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.body.copyWith(
                      color: context.textFaint,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The feed under the header: promo banner, categories, restaurants (premium
/// cards), then new products / deals. Public for the widget tests.
class HomeFeedSections extends StatelessWidget {
  const HomeFeedSections({super.key, required this.state});

  final HomeFeedState state;

  @override
  Widget build(BuildContext context) {
    final feed = state.feed;
    if (feed == null && state.loading) {
      return const SliverToBoxAdapter(child: HomeFeedSkeleton());
    }
    if (feed == null) {
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.screenH),
          child: AppCard(
            child: Row(
              children: [
                Icon(Icons.cloud_off_rounded, color: context.textMuted),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    state.error == null
                        ? context.tr('jb.common.load_failed')
                        : apiErrorText(context, state.error!),
                    style: AppTextStyles.body.copyWith(color: context.textMain),
                  ),
                ),
                TextButton(
                  onPressed: context.read<HomeFeedCubit>().load,
                  child: Text(context.tr('retry')),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return SliverList.list(
      children: [
        const SizedBox(height: AppSpacing.lg),
        Padding(
          padding: AppSpacing.screen,
          child: _PromoBanner(state: state),
        ),
        if (state.foodCategories.isNotEmpty) ...[
          _sectionTitle(context, context.tr('jb.home.categories')),
          SizedBox(
            height: 96,
            child: ListView.separated(
              padding: AppSpacing.screen,
              scrollDirection: Axis.horizontal,
              itemCount: state.foodCategories.length,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.xs),
              itemBuilder: (context, i) {
                final category = state.foodCategories[i];
                return CategoryBubble(
                  category: category,
                  onTap: () => context.push(
                    Routes.search,
                    extra: ProductListArgs.category(category),
                  ),
                );
              },
            ),
          ),
        ],
        if (state.restaurants.isNotEmpty) ...[
          _sectionTitle(
            context,
            context.tr('jb.home.restaurants'),
            onSeeAll: () => context.push(Routes.stores),
            actionLabel: context.tr('see_all'),
          ),
          SizedBox(
            // Room for the card's soft shadow under it.
            height: StoreTile.rowHeight + AppSpacing.lg,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenH,
                0,
                AppSpacing.screenH,
                AppSpacing.lg,
              ),
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: state.restaurants.length,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
              itemBuilder: (_, i) => StoreTile(
                store: state.restaurants[i],
                categoryName: state.categoryNameOf(state.restaurants[i]),
              ),
            ),
          ),
        ],
        if (state.featured.isNotEmpty) ...[
          // "Offers" only for real discounts; "see all" repeats the query that
          // filled the row, so it is never emptier than the row.
          _sectionTitle(
            context,
            context.tr(
              state.featuredAreDeals ? 'jb.home.deals' : 'jb.home.new_products',
            ),
            onSeeAll: () => context.push(
              Routes.search,
              extra: state.featuredAreDeals
                  ? ProductListArgs.deals(
                      context.tr('jb.home.deals'),
                      categoryIds: state.featuredCategoryIds,
                    )
                  : ProductListArgs.newest(
                      context.tr('jb.home.new_products'),
                      categoryIds: state.featuredCategoryIds,
                    ),
            ),
          ),
          SizedBox(
            height: 270,
            child: ListView.separated(
              padding: AppSpacing.screen,
              scrollDirection: Axis.horizontal,
              itemCount: state.featured.length,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
              itemBuilder: (_, i) => SizedBox(
                width: 165,
                child: ProductCard(product: state.featured[i]),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _sectionTitle(
    BuildContext context,
    String title, {
    VoidCallback? onSeeAll,
    String? actionLabel,
  }) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpacing.screenH,
      AppSpacing.xl,
      AppSpacing.screenH,
      AppSpacing.sm,
    ),
    child: AppSectionHeader(
      title: title,
      actionLabel: onSeeAll == null
          ? null
          : actionLabel ?? context.tr('see_more'),
      onAction: onSeeAll,
    ),
  );
}

/// Yellow promo card: "shop closed" notice, every-Nth-order free delivery,
/// or the delivery-fee call notice — always real settings, never placeholder art.
class _PromoBanner extends StatelessWidget {
  const _PromoBanner({required this.state});

  final HomeFeedState state;

  @override
  Widget build(BuildContext context) {
    final feed = state.feed!;
    final closed = state.closedMessage;
    // The cart's copy is advanced locally after each order, so prefer it.
    final loyalty = context.select<CartCubit, LoyaltyStatus?>(
      (c) => c.state.loyalty,
    );
    final every = feed.freeDeliveryEveryOrders;

    final String title;
    final String subtitle;
    final IconData icon;
    if (closed != null) {
      title = context.tr('jb.home.closed_title');
      subtitle = closed.isEmpty ? context.tr('jb.home.closed_message') : closed;
      icon = Icons.nightlight_round;
    } else if (loyalty != null && loyalty.nextOrderFree) {
      title = context.tr('jb.home.loyalty_free_title');
      subtitle = context.tr('jb.home.loyalty_free_message');
      icon = Icons.card_giftcard_rounded;
    } else if (every > 0) {
      title = context.tr('jb.home.loyalty_title', args: {'count': every});
      subtitle = loyalty == null
          ? context.tr('jb.home.loyalty_guest_message', args: {'count': every})
          : context.tr(
              'jb.home.loyalty_progress_message',
              args: {'left': loyalty.ordersUntilFree},
            );
      icon = Icons.card_giftcard_rounded;
    } else {
      title = context.tr('jb.home.delivery_title');
      subtitle = context.tr('jb.home.delivery_message');
      icon = Icons.delivery_dining_rounded;
    }

    final bg = closed != null
        ? (context.isDarkMode ? AppColors.darkElevated : AppColors.ink)
        : AppColors.accent;
    final fg = closed != null ? AppColors.white : AppColors.ink;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(color: bg, borderRadius: AppRadius.xlAll),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          PositionedDirectional(
            end: -40,
            top: -50,
            child: Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: fg.withValues(alpha: 0.08),
              ),
            ),
          ),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppTextStyles.h3.copyWith(color: fg)),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      subtitle,
                      style: AppTextStyles.body.copyWith(
                        color: fg.withValues(alpha: 0.85),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: closed != null ? AppColors.accent : AppColors.ink,
                ),
                child: Icon(
                  icon,
                  color: closed != null ? AppColors.ink : AppColors.accent,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Loading placeholder in the same order as [HomeFeedSections], so nothing
/// jumps when the feed arrives.
class HomeFeedSkeleton extends StatelessWidget {
  const HomeFeedSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.lg,
        AppSpacing.screenH,
        0,
      ),
      // One shimmer for the whole skeleton.
      child: AppSkeletonGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const AppSkeleton(height: 96, radius: AppRadius.xl),
            const SizedBox(height: AppSpacing.xl),
            const AppSkeleton(width: 140, height: 20),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: List.generate(
                4,
                (_) => const Padding(
                  padding: EdgeInsetsDirectional.only(end: AppSpacing.md),
                  child: AppSkeleton(width: 60, height: 60, radius: 30),
                ),
              ),
            ),
            // Same order as the feed: stores, then the products row.
            const SizedBox(height: AppSpacing.xl),
            const AppSkeleton(width: 120, height: 20),
            const SizedBox(height: AppSpacing.md),
            const SingleChildScrollView(
              key: ValueKey('skeleton-stores'),
              scrollDirection: Axis.horizontal,
              physics: NeverScrollableScrollPhysics(),
              child: Row(
                children: [
                  StoreTileSkeleton(),
                  SizedBox(width: AppSpacing.md),
                  StoreTileSkeleton(),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xl + AppSpacing.lg),
            const AppSkeleton(width: 120, height: 20),
            const SizedBox(height: AppSpacing.md),
            SingleChildScrollView(
              key: const ValueKey('skeleton-products'),
              scrollDirection: Axis.horizontal,
              physics: const NeverScrollableScrollPhysics(),
              child: Row(
                children: List.generate(
                  3,
                  (_) => const Padding(
                    padding: EdgeInsetsDirectional.only(end: AppSpacing.md),
                    child: AppSkeleton(
                      width: 165,
                      height: 250,
                      radius: AppRadius.lg,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
