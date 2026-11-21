import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../cart/ui/widgets/cart_icon_button.dart';
import '../data/models/store.dart';
import '../data/repo/catalog_repository.dart';
import 'widgets/paged_product_slivers.dart';
import 'widgets/search_input.dart';
import 'widgets/store_tile.dart';

/// Searchable list of every store over `GET /stores` ("See all" on Home).
class StoreListScreen extends StatefulWidget {
  const StoreListScreen({super.key});

  @override
  State<StoreListScreen> createState() => _StoreListScreenState();
}

class _StoreListScreenState extends State<StoreListScreen> {
  final _catalog = getIt<CatalogRepository>();
  late final PagedCubit<Store> _cubit = PagedCubit<Store>(_fetch);
  String _query = '';

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

  PageFetcher<Store> get _fetch {
    final q = _query;
    return (page) => _catalog.getStores(page: page, q: q);
  }

  void _search(String query) {
    if (query == _query) return;
    setState(() => _query = query);
    _cubit.reset(_fetch);
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.tr('jb.stores.title')),
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
              child: SearchInput(
                hint: context.tr('jb.stores.search_hint'),
                onChanged: _search,
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
                      BlocBuilder<PagedCubit<Store>, PagedState<Store>>(
                        builder: (context, state) => _StoreGrid(
                          state: state,
                          onRetry: _cubit.refresh,
                          onLoadMore: _cubit.loadMore,
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

/// One column on phones, more on wider screens.
class _StoreGrid extends StatelessWidget {
  const _StoreGrid({
    required this.state,
    required this.onRetry,
    required this.onLoadMore,
  });

  final PagedState<Store> state;
  final VoidCallback onRetry;
  final VoidCallback onLoadMore;

  static const _delegate = SliverGridDelegateWithMaxCrossAxisExtent(
    maxCrossAxisExtent: 480,
    childAspectRatio: 16 / 10,
    mainAxisSpacing: AppSpacing.lg,
    crossAxisSpacing: AppSpacing.lg,
  );

  @override
  Widget build(BuildContext context) {
    if (state.isFirstLoad) {
      return SliverPadding(
        padding: AppSpacing.screen,
        sliver: SliverGrid.builder(
          gridDelegate: _delegate,
          itemCount: 3,
          itemBuilder: (_, _) =>
              const StoreTileSkeleton(size: StoreTileSize.list),
        ),
      );
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
          icon: Icons.storefront_outlined,
          title: context.tr('jb.stores.empty_title'),
          message: context.tr('jb.stores.empty_message'),
        ),
      );
    }

    return SliverMainAxisGroup(
      slivers: [
        SliverPadding(
          padding: AppSpacing.screen,
          sliver: SliverGrid.builder(
            gridDelegate: _delegate,
            itemCount: state.items.length,
            itemBuilder: (_, i) =>
                StoreTile(store: state.items[i], size: StoreTileSize.list),
          ),
        ),
        SliverToBoxAdapter(
          child: PagingFooter(state: state, onLoadMore: onLoadMore),
        ),
      ],
    );
  }
}
