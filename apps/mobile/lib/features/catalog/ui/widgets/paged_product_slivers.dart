import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/api_error_text.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/paging/paged_cubit.dart';
import '../../data/models/product.dart';
import 'premium_product_card.dart';
import 'product_card.dart';

/// Responsive product grid for a [PagedState]: the Jibli loader (or shimmer
/// cards with [shimmer]) on first load,
/// full error / empty states, and a footer for "load more".
class PagedProductGrid extends StatelessWidget {
  const PagedProductGrid({
    super.key,
    required this.state,
    required this.onRetry,
    required this.onLoadMore,
    this.showStore = true,
    this.shimmer = false,
    this.emptyTitle,
    this.emptyMessage,
    this.itemWrapper,
  });

  final PagedState<Product> state;
  final VoidCallback onRetry;
  final VoidCallback onLoadMore;
  final bool showStore;

  /// Shimmer cards instead of the Jibli loader on first load (Home feed).
  final bool shimmer;
  final String? emptyTitle;
  final String? emptyMessage;

  /// Wraps each card (the store page's entrance animation).
  final Widget Function(int index, Widget card)? itemWrapper;

  @override
  Widget build(BuildContext context) {
    if (state.isFirstLoad) {
      return shimmer ? const ProductGridSkeleton() : const AppSliverLoader();
    }

    if (state.items.isEmpty && state.status == PagedStatus.failure) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: AppErrorState(
          title: context.tr('jb.common.load_failed'),
          message: state.error == null
              ? null
              : apiErrorText(context, state.error!),
          retryLabel: context.tr('retry'),
          onRetry: onRetry,
        ),
      );
    }

    if (state.isEmpty) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: AppEmptyState(
          icon: Icons.search_off_rounded,
          title: emptyTitle ?? context.tr('jb.products.empty_title'),
          message: emptyMessage ?? context.tr('jb.products.empty_message'),
        ),
      );
    }

    return SliverMainAxisGroup(
      slivers: [
        SliverPadding(
          padding: AppSpacing.screen,
          sliver: SliverGrid.builder(
            gridDelegate: productGridDelegate(context),
            itemCount: state.items.length,
            itemBuilder: (context, i) {
              final card = ProductCard(
                product: state.items[i],
                showStore: showStore,
              );
              return itemWrapper?.call(i, card) ?? card;
            },
          ),
        ),
        SliverToBoxAdapter(
          child: PagingFooter(state: state, onLoadMore: onLoadMore),
        ),
      ],
    );
  }
}

/// The home "Popular dishes" feed: one [PremiumProductCard] per row (two
/// columns from 600 pt), free scroll, same states as [PagedProductGrid].
/// Each card fades and rises 12 pt the first time it is painted on screen,
/// never again on scroll back (see [RevealOnScroll]).
///
/// Card widgets are kept per product, so appending a page only builds the
/// new cards: the ones already on screen are the same widget instances and
/// are skipped by the framework.
class PagedProductList extends StatefulWidget {
  const PagedProductList({
    super.key,
    required this.state,
    required this.onRetry,
    required this.onLoadMore,
    this.emptyTitle,
    this.emptyMessage,
    this.header,
    this.collapseWhenEmpty = false,
    this.hasHero,
  });

  final PagedState<Product> state;
  final VoidCallback onRetry;
  final VoidCallback onLoadMore;
  final String? emptyTitle;
  final String? emptyMessage;

  /// Shown above the cards, only once there is at least one card.
  final Widget? header;

  /// A continuation list (the random fast-food section): no skeleton, no
  /// empty or error state, nothing at all until it has cards (a spinner
  /// while its first page loads).
  final bool collapseWhenEmpty;

  /// Whether a card flies its photo to the product page. `false` for a
  /// product another list on the same screen already shows with a Hero
  /// (two Heroes may not share a tag). Defaults to every card.
  final bool Function(Product product)? hasHero;

  /// Gap between cards: one card and the top of the next show on a phone.
  static const double gap = AppSpacing.lg;

  @override
  State<PagedProductList> createState() => _PagedProductListState();
}

class _PagedProductListState extends State<PagedProductList> {
  /// Products that already played their entrance (lazy lists rebuild them).
  final Set<Object> _revealed = {};

  /// Built card per product id, reused while the product object and its
  /// Hero flag are unchanged.
  final Map<String, ({Product product, bool hero, Widget card})> _cards = {};

  Widget _card(Product product) {
    final hero = widget.hasHero?.call(product) ?? true;
    final cached = _cards[product.id];
    if (cached != null &&
        identical(cached.product, product) &&
        cached.hero == hero) {
      return cached.card;
    }
    final card = RevealOnScroll(
      key: ValueKey('reveal-${product.id}'),
      id: product.id,
      revealed: _revealed,
      child: PremiumProductCard(product: product, hero: hero),
    );
    _cards[product.id] = (product: product, hero: hero, card: card);
    return card;
  }

  @override
  void didUpdateWidget(PagedProductList old) {
    super.didUpdateWidget(old);
    // A new query (pull-to-refresh, new seed) starts from scratch.
    if (widget.state.items.isEmpty) {
      _cards.clear();
      _revealed.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    if (widget.collapseWhenEmpty && state.items.isEmpty) {
      return SliverToBoxAdapter(
        child: state.status == PagedStatus.loading
            ? const Padding(
                padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                child: Center(child: AppLoader(size: 40)),
              )
            : const SizedBox.shrink(),
      );
    }
    if (state.isFirstLoad) return const PremiumProductListSkeleton();

    if (state.items.isEmpty && state.status == PagedStatus.failure) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: AppErrorState(
          title: context.tr('jb.common.load_failed'),
          message: state.error == null
              ? null
              : apiErrorText(context, state.error!),
          retryLabel: context.tr('retry'),
          onRetry: widget.onRetry,
        ),
      );
    }

    if (state.isEmpty) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: AppEmptyState(
          icon: Icons.search_off_rounded,
          title: widget.emptyTitle ?? context.tr('jb.products.empty_title'),
          message:
              widget.emptyMessage ?? context.tr('jb.products.empty_message'),
        ),
      );
    }

    // A product repeated across pages would show twice and duplicate its
    // Hero tag.
    final seen = <String>{};
    final items = [
      for (final p in state.items)
        if (seen.add(p.id)) p,
    ];
    _cards.removeWhere((id, _) => !seen.contains(id));
    final columns = premiumColumns(MediaQuery.sizeOf(context).width);
    final rows = (items.length / columns).ceil();

    return SliverMainAxisGroup(
      slivers: [
        if (widget.header != null) SliverToBoxAdapter(child: widget.header),
        SliverPadding(
          padding: AppSpacing.screen,
          sliver: SliverList.separated(
            itemCount: rows,
            separatorBuilder: (_, _) =>
                const SizedBox(height: PagedProductList.gap),
            itemBuilder: (context, row) {
              if (columns == 1) return _card(items[row]);
              final start = row * columns;
              return Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth:
                        PremiumProductCard.maxWidth * columns +
                        PagedProductList.gap * (columns - 1),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var c = 0; c < columns; c++) ...[
                        if (c > 0) const SizedBox(width: PagedProductList.gap),
                        Expanded(
                          child: start + c < items.length
                              ? _card(items[start + c])
                              : const SizedBox.shrink(),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        SliverToBoxAdapter(
          child: PagingFooter(state: state, onLoadMore: widget.onLoadMore),
        ),
      ],
    );
  }
}

/// One column of premium cards on phones, two from 600 pt, never more.
int premiumColumns(double width) => width >= Breakpoints.tablet ? 2 : 1;

/// Logical size of a premium card's photo on a screen [width] wide (for
/// precaching the next photos at the size the cards will ask for).
Size premiumPhotoSize(double width) {
  final columns = premiumColumns(width);
  final content = width - 2 * AppSpacing.screenH;
  var card = (content - PagedProductList.gap * (columns - 1)) / columns;
  if (card > PremiumProductCard.maxWidth) card = PremiumProductCard.maxWidth;
  return Size(card, card / PremiumProductCard.photoAspect);
}

/// Two premium card skeletons (one row of two on tablets).
class PremiumProductListSkeleton extends StatelessWidget {
  const PremiumProductListSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final columns = premiumColumns(MediaQuery.sizeOf(context).width);
    final Widget content = columns == 1
        ? const Column(
            children: [
              PremiumProductCardSkeleton(),
              SizedBox(height: PagedProductList.gap),
              PremiumProductCardSkeleton(),
            ],
          )
        : Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth:
                    PremiumProductCard.maxWidth * 2 + PagedProductList.gap,
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: PremiumProductCardSkeleton()),
                  SizedBox(width: PagedProductList.gap),
                  Expanded(child: PremiumProductCardSkeleton()),
                ],
              ),
            ),
          );
    return SliverPadding(
      padding: AppSpacing.screen,
      sliver: SliverToBoxAdapter(
        child: KeyedSubtree(
          key: const ValueKey('premium-skeleton'),
          child: content,
        ),
      ),
    );
  }
}

/// Hidden until it is first painted on screen, then fades in and rises
/// 12 pt (250 ms, easeOutCubic), once per [id]. With Reduce Motion it does
/// not play.
///
/// Costs nothing while scrolling: lazy slivers lay out cards ahead of the
/// viewport but only paint the visible ones, so the first paint is the
/// "entered the screen" signal. No scroll listener, no `localToGlobal`.
/// At rest the fade is at 1 and the offset at zero, which paint the card
/// directly (no opacity or transform layer).
class RevealOnScroll extends StatefulWidget {
  const RevealOnScroll({
    super.key,
    required this.id,
    required this.revealed,
    required this.child,
  });

  /// What was revealed (the product id): kept in [revealed] so a card
  /// rebuilt after scrolling away does not replay.
  final Object id;

  /// Shared by the list; outlives the cards.
  final Set<Object> revealed;
  final Widget child;

  @override
  State<RevealOnScroll> createState() => _RevealOnScrollState();

  /// Entrance progress (0 hidden, 1 revealed) of a [RevealOnScroll] state.
  @visibleForTesting
  static double progressOf(State<RevealOnScroll> state) =>
      (state as _RevealOnScrollState)._curve.value;
}

class _RevealOnScrollState extends State<RevealOnScroll>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 250),
    value: widget.revealed.contains(widget.id) ? 1 : 0,
  );
  late final Animation<double> _curve = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeOutCubic,
  );

  bool get _waiting => _controller.value == 0 && !_controller.isAnimating;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reduce Motion: no entrance at all, the card is simply there.
    if (MediaQuery.disableAnimationsOf(context) && _controller.value < 1) {
      _controller.value = 1;
      widget.revealed.add(widget.id);
    }
  }

  void _onFirstPaint() {
    if (!mounted || !_waiting) return;
    widget.revealed.add(widget.id);
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Same tree before, during and after, so the card keeps its state.
    return _Reveal(
      progress: _curve,
      onFirstPaint: _waiting ? _onFirstPaint : null,
      child: widget.child,
    );
  }
}

/// Paints its child faded and shifted down by `12 × (1 - progress)` pt,
/// and calls [onFirstPaint] after the first frame that paints it.
///
/// Repaint only (no rebuild, no relayout) while it plays; at progress 1 the
/// child is painted directly: no opacity layer, no transform.
class _Reveal extends SingleChildRenderObjectWidget {
  const _Reveal({
    required this.progress,
    required this.onFirstPaint,
    super.child,
  });

  final Animation<double> progress;
  final VoidCallback? onFirstPaint;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderReveal(progress)..onFirstPaint = onFirstPaint;

  @override
  void updateRenderObject(BuildContext context, _RenderReveal render) => render
    ..progress = progress
    ..onFirstPaint = onFirstPaint;
}

class _RenderReveal extends RenderProxyBox {
  _RenderReveal(this._progress);

  /// Rise distance of the entrance.
  static const double _rise = 12;

  VoidCallback? onFirstPaint;

  Animation<double> _progress;
  set progress(Animation<double> value) {
    if (value == _progress) return;
    if (attached) {
      _progress.removeListener(markNeedsPaint);
      value.addListener(markNeedsPaint);
    }
    _progress = value;
    markNeedsPaint();
  }

  Offset get _shift => Offset(0, _rise * (1 - _progress.value));

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    _progress.addListener(markNeedsPaint);
  }

  @override
  void detach() {
    _progress.removeListener(markNeedsPaint);
    super.detach();
  }

  @override
  bool get alwaysNeedsCompositing => child != null && _alpha < 255;

  int get _alpha => (_progress.value.clamp(0.0, 1.0) * 255).round();

  @override
  void paint(PaintingContext context, Offset offset) {
    final callback = onFirstPaint;
    if (callback != null) {
      onFirstPaint = null;
      SchedulerBinding.instance.addPostFrameCallback((_) => callback());
    }
    final child = this.child;
    if (child == null) return;
    final alpha = _alpha;
    if (alpha == 0) {
      layer = null;
      return;
    }
    final at = offset + _shift;
    if (alpha == 255) {
      layer = null;
      context.paintChild(child, at);
      return;
    }
    layer = context.pushOpacity(
      at,
      alpha,
      (context, offset) => context.paintChild(child, offset),
      oldLayer: layer as OpacityLayer?,
    );
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      result.addWithPaintOffset(
        offset: _shift,
        position: position,
        hitTest: (result, transformed) =>
            super.hitTestChildren(result, position: transformed),
      );

  @override
  void applyPaintTransform(RenderBox child, Matrix4 transform) {
    final shift = _shift;
    transform.translateByDouble(shift.dx, shift.dy, 0, 1);
  }
}

SliverGridDelegate productGridDelegate(BuildContext context) =>
    SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: Responsive.gridColumns(MediaQuery.sizeOf(context).width),
      mainAxisSpacing: AppSpacing.md,
      crossAxisSpacing: AppSpacing.md,
      childAspectRatio: ProductCard.aspectRatio,
    );

/// Spinner while the next page loads, inline retry when it failed.
class PagingFooter extends StatelessWidget {
  const PagingFooter({
    super.key,
    required this.state,
    required this.onLoadMore,
  });

  final PagedState<dynamic> state;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    Widget child = const SizedBox.shrink();
    if (state.loadingMore) {
      child = const AppLoader(size: 40);
    } else if (state.error != null && state.items.isNotEmpty) {
      child = TextButton.icon(
        onPressed: onLoadMore,
        icon: const Icon(Icons.refresh_rounded),
        label: Text(context.tr('retry')),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Center(child: child),
    );
  }
}

class ProductGridSkeleton extends StatelessWidget {
  const ProductGridSkeleton({super.key, this.count = 6});

  final int count;

  @override
  Widget build(BuildContext context) {
    return SliverPadding(
      padding: AppSpacing.screen,
      sliver: SliverGrid.builder(
        gridDelegate: productGridDelegate(context),
        itemCount: count,
        itemBuilder: (_, _) =>
            const AppSkeleton(height: double.infinity, radius: AppRadius.lg),
      ),
    );
  }
}

/// Calls [onLoadMore] when the scroll is near the end. Wrap the
/// `CustomScrollView` of any paged screen with it.
class LoadMoreListener extends StatelessWidget {
  const LoadMoreListener({
    super.key,
    required this.onLoadMore,
    required this.child,
  });

  final VoidCallback onLoadMore;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.axis == Axis.vertical && n.metrics.extentAfter < 600) {
          onLoadMore();
        }
        return false;
      },
      child: child,
    );
  }
}
