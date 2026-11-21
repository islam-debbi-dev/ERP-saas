import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/config/category_groups.dart';
import '../../../core/components/widgets/staggered_entrance.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../cart/ui/widgets/floating_cart_bar.dart';
import '../data/models/product.dart';
import '../data/models/store.dart';
import '../data/repo/catalog_repository.dart';
import 'store/store_category_bar.dart';
import 'store/store_header.dart';
import 'store/store_menu_cubit.dart';
import 'store/store_product_row.dart';
import 'widgets/load_state_view.dart';
import 'widgets/paged_product_slivers.dart';

/// Store page: compact header, sticky section pills, and the products of
/// the selected section only. Opens with two parallel requests:
/// `GET /stores/:id` (header + sections) and the first `/products` page.
class StoreDetailsScreen extends StatelessWidget {
  const StoreDetailsScreen({super.key, required this.storeId});

  final String storeId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => StoreMenuCubit(
        repository: getIt<CatalogRepository>(),
        storeId: storeId,
      )..start(),
      child: const _StoreView(),
    );
  }
}

/// Food stores (any section in the `food` group, or no sections) list
/// dishes as rows; grocery-like stores keep the product grid.
bool storeUsesRows(Store store) {
  if (store.categories.isEmpty) return true;
  final food = CategoryGroup.food.slugs.toSet();
  return store.categories.any((c) => food.contains(c.slug));
}

class _StoreView extends StatefulWidget {
  const _StoreView();

  @override
  State<_StoreView> createState() => _StoreViewState();
}

class _StoreViewState extends State<_StoreView>
    with SingleTickerProviderStateMixin {
  final _scroll = ScrollController();
  final _headerKey = GlobalKey();

  /// Fades the products in after a section switch.
  late final AnimationController _fade = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 220),
    value: 1,
  );

  @override
  void dispose() {
    _scroll.dispose();
    _fade.dispose();
    super.dispose();
  }

  /// +1 when the last switch went to a later section, -1 to an earlier
  /// one, 0 on the first load: the products slide in from that side.
  int _direction = 0;

  /// Bumped when a section's first page arrives, so its items replay the
  /// entrance once (scrolling back to them later does not).
  int _generation = 0;
  DateTime _entranceUntil = DateTime.now().add(_entranceWindow);
  static const _entranceWindow = Duration(milliseconds: 400);

  /// Only the first rows on screen animate.
  static const _animatedItems = 8;

  /// Switching section keeps the reader at the top of the products (the
  /// tiles stay pinned) rather than jumping back to the cover.
  void _select(String? categoryId, double collapseRange) {
    final cubit = context.read<StoreMenuCubit>();
    final order = _sectionOrder(cubit.state);
    final from = order.indexOf(cubit.state.selectedCategoryId);
    final to = order.indexOf(categoryId);
    if (from != to) _direction = to > from ? 1 : -1;
    final headerHeight = _headerKey.currentContext?.size?.height ?? 0;
    final productsTop = collapseRange + headerHeight;
    if (_scroll.hasClients && _scroll.offset > productsTop) {
      _scroll.jumpTo(productsTop);
    }
    cubit.select(categoryId);
  }

  /// "All" (`null`) then the sections, in the bar's order.
  List<String?> _sectionOrder(StoreMenuState state) => [
    null,
    for (final c in state.categories) c.id,
  ];

  /// Swiping the list sideways moves to the next / previous section,
  /// following the reading direction.
  void _onSwipe(DragEndDetails details, double collapseRange) {
    final v = details.primaryVelocity ?? 0;
    if (v.abs() < 300) return;
    final state = context.read<StoreMenuCubit>().state;
    final order = _sectionOrder(state);
    if (order.length < 2) return;
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final forward = rtl ? v > 0 : v < 0;
    final next = order.indexOf(state.selectedCategoryId) + (forward ? 1 : -1);
    if (next < 0 || next >= order.length) return;
    _select(order[next], collapseRange);
  }

  /// Wraps the product at [index] of the current section in its entrance.
  Widget _entrance(int index, Widget child) => StaggeredEntrance(
    key: ValueKey('entrance-$_generation-$index'),
    index: index,
    enabled: index < _animatedItems && DateTime.now().isBefore(_entranceUntil),
    from: Offset(24.0 * _direction, _direction == 0 ? 12 : 0),
    step: const Duration(milliseconds: 25),
    maxDelay: const Duration(milliseconds: 75),
    duration: const Duration(milliseconds: 170),
    child: child,
  );

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<StoreMenuCubit>();
    return BlocBuilder<StoreMenuCubit, StoreMenuState>(
      builder: (context, state) {
        final store = state.store;
        if (store == null) {
          return Scaffold(
            appBar: AppBar(),
            body: LoadStateView<Store>(
              state: LoadState<Store>(
                loading: state.loading,
                error: state.error,
              ),
              onRetry: cubit.load,
              builder: (_, _) => const SizedBox.shrink(),
            ),
          );
        }
        final nav = StoreNavHeaderDelegate(
          store: store,
          topInset: MediaQuery.paddingOf(context).top,
        );
        return Scaffold(
          bottomNavigationBar: const SafeArea(
            top: false,
            child: FloatingCartBar(),
          ),
          body: RefreshIndicator(
            edgeOffset: nav.minExtent,
            onRefresh: cubit.refresh,
            child: LoadMoreListener(
              onLoadMore: cubit.products.loadMore,
              child: GestureDetector(
                onHorizontalDragEnd: (d) => _onSwipe(d, nav.collapseRange),
                child: CustomScrollView(
                  controller: _scroll,
                  slivers: [
                    SliverPersistentHeader(pinned: true, delegate: nav),
                    SliverToBoxAdapter(
                      child: StoreHeader(key: _headerKey, store: store),
                    ),
                    if (store.categories.isNotEmpty)
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: StoreCategoryBarDelegate(
                          categories: store.categories,
                          total: store.menuProductCount,
                          selectedId: state.selectedCategoryId,
                          onSelect: (id) => _select(id, nav.collapseRange),
                          textScale: MediaQuery.textScalerOf(context).scale(1),
                        ),
                      ),
                    BlocConsumer<PagedCubit<Product>, PagedState<Product>>(
                      bloc: cubit.products,
                      listenWhen: (a, b) => a.isFirstLoad && !b.isFirstLoad,
                      listener: (_, _) {
                        // Cross-fade (also with Reduce Motion: fade only);
                        // the rows slide in from the selected side.
                        setState(() {
                          _generation++;
                          _entranceUntil = DateTime.now().add(_entranceWindow);
                        });
                        _fade.forward(from: 0);
                      },
                      builder: (context, products) => SliverFadeTransition(
                        opacity: _fade,
                        sliver: storeUsesRows(store)
                            ? _ProductRows(
                                state: products,
                                onRetry: cubit.products.refresh,
                                onLoadMore: cubit.products.loadMore,
                                itemWrapper: _entrance,
                              )
                            : PagedProductGrid(
                                state: products,
                                showStore: false,
                                shimmer: true,
                                emptyTitle: context.tr(
                                  'jb.store.section_empty_title',
                                ),
                                emptyMessage: context.tr(
                                  'jb.store.section_empty_message',
                                ),
                                onRetry: cubit.products.refresh,
                                onLoadMore: cubit.products.loadMore,
                                itemWrapper: _entrance,
                              ),
                      ),
                    ),
                    // Room below a short section, so switching to it keeps the
                    // pills pinned at the top instead of bouncing to the cover.
                    SliverLayoutBuilder(
                      builder: (context, constraints) {
                        // The header sliver is laid out before this one.
                        final box =
                            _headerKey.currentContext?.findRenderObject()
                                as RenderBox?;
                        final headerHeight = box != null && box.hasSize
                            ? box.size.height
                            : 0.0;
                        final needed =
                            nav.collapseRange +
                            headerHeight +
                            constraints.viewportMainAxisExtent -
                            constraints.precedingScrollExtent;
                        return SliverToBoxAdapter(
                          child: SizedBox(
                            height: needed > AppSpacing.huge
                                ? needed
                                : AppSpacing.huge,
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Paged list of [StoreProductRow]s with shimmer, error and empty states.
class _ProductRows extends StatelessWidget {
  const _ProductRows({
    required this.state,
    required this.onRetry,
    required this.onLoadMore,
    required this.itemWrapper,
  });

  final PagedState<Product> state;
  final VoidCallback onRetry;
  final VoidCallback onLoadMore;
  final Widget Function(int index, Widget row) itemWrapper;

  @override
  Widget build(BuildContext context) {
    if (state.isFirstLoad) {
      return SliverList.builder(
        itemCount: 4,
        itemBuilder: (_, _) => const StoreProductRowSkeleton(),
      );
    }
    if (state.items.isEmpty && state.status == PagedStatus.failure) {
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
          child: AppErrorState(
            title: context.tr('jb.common.load_failed'),
            message: state.error == null
                ? null
                : apiErrorText(context, state.error!),
            retryLabel: context.tr('retry'),
            onRetry: onRetry,
          ),
        ),
      );
    }
    if (state.isEmpty) {
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
          child: AppEmptyState(
            icon: Icons.restaurant_menu_rounded,
            title: context.tr('jb.store.section_empty_title'),
            message: context.tr('jb.store.section_empty_message'),
          ),
        ),
      );
    }
    return SliverMainAxisGroup(
      slivers: [
        SliverList.separated(
          itemCount: state.items.length,
          itemBuilder: (_, i) =>
              itemWrapper(i, StoreProductRow(product: state.items[i])),
          separatorBuilder: (context, _) => Divider(
            height: 0.5,
            thickness: 0.5,
            indent: AppSpacing.screenH,
            endIndent: AppSpacing.screenH,
            color: context.fieldBorder,
          ),
        ),
        SliverToBoxAdapter(
          child: PagingFooter(state: state, onLoadMore: onLoadMore),
        ),
      ],
    );
  }
}
