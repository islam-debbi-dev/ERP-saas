import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../cart/ui/widgets/cart_icon_button.dart';
import '../../cart/ui/widgets/floating_cart_bar.dart';
import '../data/models/category.dart';
import '../data/models/product.dart';
import '../data/models/product_query.dart';
import '../data/repo/catalog_repository.dart';
import 'widgets/paged_product_slivers.dart';
import 'widgets/search_input.dart';
import 'widgets/sort_button.dart';

/// What [ProductListScreen] lists: free search, one category, deals, or the
/// newest products.
class ProductListArgs {
  final String title;
  final String? categoryId;

  /// Restricts the list to a tab's category group (e.g. food on Home).
  final List<String>? categoryIds;
  final bool onSale;
  final bool autofocusSearch;
  final String? searchHint;

  const ProductListArgs._({
    required this.title,
    this.categoryId,
    this.categoryIds,
    this.onSale = false,
    this.autofocusSearch = false,
    this.searchHint,
  });

  factory ProductListArgs.search(
    String title, {
    List<String>? categoryIds,
    String? hint,
  }) => ProductListArgs._(
    title: title,
    categoryIds: categoryIds,
    autofocusSearch: true,
    searchHint: hint,
  );

  factory ProductListArgs.category(Category category) =>
      ProductListArgs._(title: category.name, categoryId: category.id);

  factory ProductListArgs.deals(String title, {List<String>? categoryIds}) =>
      ProductListArgs._(title: title, onSale: true, categoryIds: categoryIds);

  /// The plain list in the backend's default order (newest first), which is
  /// what fills the home row when nothing is discounted.
  factory ProductListArgs.newest(String title, {List<String>? categoryIds}) =>
      ProductListArgs._(title: title, categoryIds: categoryIds);
}

/// Searchable, sortable product grid over `GET /products`.
class ProductListScreen extends StatefulWidget {
  const ProductListScreen({super.key, required this.args});

  final ProductListArgs args;

  @override
  State<ProductListScreen> createState() => _ProductListScreenState();
}

class _ProductListScreenState extends State<ProductListScreen> {
  final _catalog = getIt<CatalogRepository>();
  late final PagedCubit<Product> _cubit = PagedCubit<Product>(_fetch);
  String _query = '';
  ProductSort _sort = ProductSort.recommended;

  @override
  void initState() {
    super.initState();
    _cubit.refresh();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  PageFetcher<Product> get _fetch {
    final q = _query;
    final sort = _sort.value;
    return (page) => _catalog.getProducts(
      ProductQuery(
        page: page,
        q: q,
        sort: sort,
        categoryId: widget.args.categoryId,
        categoryIds: widget.args.categoryIds,
        onSale: widget.args.onSale ? true : null,
      ),
    );
  }

  /// The deals list with no search typed: an empty result means "no offers".
  bool get _noDeals => widget.args.onSale && _query.trim().isEmpty;

  void _apply({String? query, ProductSort? sort}) {
    setState(() {
      _query = query ?? _query;
      _sort = sort ?? _sort;
    });
    _cubit.reset(_fetch);
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        bottomNavigationBar: const SafeArea(
          top: false,
          child: FloatingCartBar(),
        ),
        appBar: AppBar(
          title: Text(widget.args.title),
          actions: const [
            CartIconButton(),
            SizedBox(width: AppSpacing.md),
          ],
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenH,
                AppSpacing.sm,
                AppSpacing.screenH,
                AppSpacing.md,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: SearchInput(
                      autofocus: widget.args.autofocusSearch,
                      hint: widget.args.searchHint,
                      onChanged: (q) => q == _query ? null : _apply(query: q),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  SortButton(
                    value: _sort,
                    onChanged: (s) => _apply(sort: s),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _cubit.refresh,
                child: LoadMoreListener(
                  onLoadMore: _cubit.loadMore,
                  child: CustomScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    slivers: [
                      BlocBuilder<PagedCubit<Product>, PagedState<Product>>(
                        builder: (context, state) => PagedProductGrid(
                          state: state,
                          onRetry: _cubit.refresh,
                          onLoadMore: _cubit.loadMore,
                          // No discount anywhere is not a failed search.
                          emptyTitle: _noDeals
                              ? context.tr('jb.products.no_deals_title')
                              : null,
                          emptyMessage: _noDeals
                              ? context.tr('jb.products.no_deals_message')
                              : null,
                        ),
                      ),
                      const SliverToBoxAdapter(
                        child: SizedBox(height: AppSpacing.huge),
                      ),
                    ],
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
