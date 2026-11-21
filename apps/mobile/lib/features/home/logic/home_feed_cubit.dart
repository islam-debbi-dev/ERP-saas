import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/config/category_groups.dart';
import '../../../core/models/app_config.dart';
import '../../../core/service/api_error_handler.dart';
import '../../../core/service/api_result.dart';
import '../../cart/logic/cart_cubit.dart';
import '../../catalog/data/models/category.dart';
import '../../catalog/data/models/home_feed.dart';
import '../../catalog/data/models/product.dart';
import '../../catalog/data/models/store.dart';
import '../../catalog/data/repo/catalog_repository.dart';

class HomeFeedState {
  final HomeFeed? feed;
  final AppConfig? config;
  final bool loading;
  final ErrorHandler? error;

  const HomeFeedState({
    this.feed,
    this.config,
    this.loading = true,
    this.error,
  });

  /// Home is the food tab: `/home?group=food` already narrows every section
  /// to the food categories (in the group's order) on the backend, and widens
  /// a section instead of leaving it empty.
  List<Category> get foodCategories => feed?.categories ?? const [];

  Set<String> get foodCategoryIds => {for (final c in foodCategories) c.id};

  /// The food categories that are fast food ([CategoryGroup.fastFood]),
  /// resolved by slug like the food group.
  List<String> get fastFoodCategoryIds => [
    for (final c in foodCategories)
      if (CategoryGroup.fastFood.contains(c.slug)) c.id,
  ];

  /// The highlighted row: discounted dishes (biggest discount first), or the
  /// newest dishes when nothing is discounted. See [featuredAreDeals].
  List<Product> get featured => feed?.featuredProducts ?? const [];

  /// Whether [featured] may be titled "Offers" (never for plain products).
  bool get featuredAreDeals => feed?.featuredAreDeals ?? false;

  /// Categories "see all" narrows to: the food group when the row came from
  /// it, `null` (whole catalog) when the backend had to widen the row.
  List<String>? get featuredCategoryIds =>
      (feed?.featuredInGroup ?? true) && foodCategoryIds.isNotEmpty
      ? foodCategoryIds.toList()
      : null;

  /// Open restaurants: stores selling at least one food category.
  List<Store> get restaurants => feed?.stores ?? const [];

  /// Name of the first of [store]'s categories the feed knows (the food
  /// categories row), for the store card's subtitle.
  String? categoryNameOf(Store store) {
    for (final id in store.categoryIds) {
      for (final c in foodCategories) {
        if (c.id == id) return c.name;
      }
    }
    return null;
  }

  /// Admin numbers customers can call to order by phone (empty ones dropped).
  List<String> get orderPhones => [
    for (final phone in [feed?.supportPhone, feed?.supportPhone2])
      if (phone != null && phone.trim().isNotEmpty) phone.trim(),
  ];

  /// Closed shop: ordering disabled with the admin's message.
  String? get closedMessage {
    if (feed?.orderingEnabled ?? true) return null;
    final message = config?.closedMessage ?? '';
    return message;
  }
}

/// `GET /home?group=food` + `GET /app/config` in parallel; pushes the pricing rules
/// into the cart so totals always match the backend settings.
class HomeFeedCubit extends Cubit<HomeFeedState> {
  HomeFeedCubit(this._catalog, this._cart) : super(const HomeFeedState());

  final CatalogRepository _catalog;
  final CartCubit _cart;

  Future<void> load() async {
    emit(HomeFeedState(feed: state.feed, config: state.config, loading: true));
    final results = await Future.wait([
      _catalog.getHome(limit: 40, group: CategoryGroup.food.name),
      _catalog.getAppConfig(),
    ]);
    if (isClosed) return;

    final home = results[0] as ApiResult<HomeFeed>;
    final config = results[1] as ApiResult<AppConfig>;

    AppConfig? configData = state.config;
    if (config case Success(:final data)) {
      configData = data;
      _cart.applyConfig(data);
    }

    switch (home) {
      case Success(:final data):
        _cart.applyHomeFeed(data);
        emit(HomeFeedState(feed: data, config: configData, loading: false));
      case Failure(:final message):
        emit(
          HomeFeedState(
            feed: state.feed,
            config: configData,
            loading: false,
            error: message,
          ),
        );
    }
  }
}
