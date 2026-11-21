import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/config/category_groups.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../../core/service/api_error_handler.dart';
import '../../../core/service/api_result.dart';
import '../../cart/ui/widgets/cart_icon_button.dart';
import '../data/models/category.dart';
import '../data/models/product.dart';
import '../data/models/product_query.dart';
import '../data/repo/catalog_repository.dart';
import 'widgets/paged_product_slivers.dart';
import 'widgets/search_input.dart';
import 'widgets/sort_button.dart';

/// Tabs 2 and 3: products of one [CategoryGroup], with category chips,
/// search and sort. The group's slugs are resolved against `/categories`.
class CategoryGroupProductsScreen extends StatefulWidget {
  const CategoryGroupProductsScreen({super.key, required this.group});

  final CategoryGroup group;

  @override
  State<CategoryGroupProductsScreen> createState() =>
      _CategoryGroupProductsScreenState();
}

class _CategoryGroupProductsScreenState
    extends State<CategoryGroupProductsScreen> {
  final _catalog = getIt<CatalogRepository>();
  late final PagedCubit<Product> _products = PagedCubit<Product>(_fetch);

  List<Category>? _categories;
  ErrorHandler? _categoriesError;
  String? _selectedId;
  String _query = '';
  ProductSort _sort = ProductSort.recommended;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  @override
  void dispose() {
    _products.close();
    super.dispose();
  }

  String get _titleKey => switch (widget.group) {
    CategoryGroup.food => 'jb.tabs.food',
    CategoryGroup.produce => 'jb.tabs.produce',
    CategoryGroup.supermarket => 'jb.tabs.supermarket',
  };

  Future<void> _loadCategories() async {
    setState(() => _categoriesError = null);
    final result = await _catalog.getCategories();
    if (!mounted) return;
    switch (result) {
      case Success(:final data):
        final bySlug = {for (final c in data) c.slug: c};
        setState(() {
          _categories = [
            for (final slug in widget.group.slugs)
              if (bySlug[slug] != null) bySlug[slug]!,
          ];
        });
        if (_categories!.isNotEmpty) _products.reset(_fetch);
      case Failure(:final message):
        setState(() => _categoriesError = message);
    }
  }

  PageFetcher<Product> get _fetch {
    final ids = [for (final c in _categories ?? const <Category>[]) c.id];
    final selected = _selectedId;
    final q = _query;
    final sort = _sort.value;
    return (page) => _catalog.getProducts(
      ProductQuery(
        page: page,
        categoryId: selected,
        categoryIds: ids,
        q: q,
        sort: sort,
      ),
    );
  }

  void _apply({
    String? query,
    ProductSort? sort,
    String? categoryId,
    bool all = false,
  }) {
    setState(() {
      _query = query ?? _query;
      _sort = sort ?? _sort;
      if (all) _selectedId = null;
      if (categoryId != null) _selectedId = categoryId;
    });
    _products.reset(_fetch);
  }

  Future<void> _refresh() async {
    if (_categories == null || _categories!.isEmpty) return _loadCategories();
    return _products.refresh();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _products,
      child: Scaffold(
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: LoadMoreListener(
              onLoadMore: _products.loadMore,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                slivers: [
                  SliverToBoxAdapter(child: _header(context)),
                  ..._body(context),
                  const SliverToBoxAdapter(child: SizedBox(height: 200)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.md,
        AppSpacing.screenH,
        AppSpacing.md,
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  context.tr(_titleKey),
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
              ),
              const CartIconButton(),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: SearchInput(
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
        ],
      ),
    );
  }

  List<Widget> _body(BuildContext context) {
    if (_categoriesError != null) {
      return [
        SliverFillRemaining(
          hasScrollBody: false,
          child: AppErrorState(
            title: context.tr('jb.common.load_failed'),
            message: apiErrorText(context, _categoriesError!),
            retryLabel: context.tr('retry'),
            onRetry: _loadCategories,
          ),
        ),
      ];
    }
    final categories = _categories;
    if (categories == null) return const [AppSliverLoader()];
    if (categories.isEmpty) {
      return [
        SliverFillRemaining(
          hasScrollBody: false,
          child: AppEmptyState(
            icon: Icons.storefront_outlined,
            title: context.tr('jb.products.group_empty_title'),
            message: context.tr('jb.products.group_empty_message'),
          ),
        ),
      ];
    }
    return [
      SliverToBoxAdapter(
        child: SizedBox(
          height: 48,
          child: ListView(
            padding: AppSpacing.screen,
            scrollDirection: Axis.horizontal,
            children: [
              AppChoiceChip(
                label: context.tr('jb.common.all'),
                selected: _selectedId == null,
                onTap: () => _apply(all: true),
              ),
              for (final c in categories) ...[
                const SizedBox(width: AppSpacing.sm),
                AppChoiceChip(
                  label: c.icon.isEmpty ? c.name : '${c.icon}  ${c.name}',
                  selected: _selectedId == c.id,
                  onTap: () => _apply(categoryId: c.id),
                ),
              ],
            ],
          ),
        ),
      ),
      const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.md)),
      BlocBuilder<PagedCubit<Product>, PagedState<Product>>(
        builder: (context, state) => PagedProductGrid(
          state: state,
          onRetry: _products.refresh,
          onLoadMore: _products.loadMore,
        ),
      ),
    ];
  }
}
