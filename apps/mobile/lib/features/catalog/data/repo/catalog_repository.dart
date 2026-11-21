import '../../../../core/models/app_config.dart';
import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/service/api_result.dart';
import '../models/category.dart';
import '../models/home_feed.dart';
import '../models/product.dart';
import '../models/product_query.dart';
import '../models/store.dart';

/// Public catalog: `/app/config`, `/home`, `/categories`, `/stores`,
/// `/products`. Works for guests; a token only changes the response language.
class CatalogRepository {
  CatalogRepository(this._client);

  final ApiClient _client;

  static Map<String, dynamic> _data(Map<String, dynamic> body) =>
      body['data'] as Map<String, dynamic>;

  static List<T> _list<T>(
    Map<String, dynamic> body,
    T Function(Map<String, dynamic>) fromJson,
  ) => (body['data'] as List<dynamic>)
      .map((e) => fromJson(e as Map<String, dynamic>))
      .toList();

  Future<ApiResult<AppConfig>> getAppConfig() => _client.get(
    '/app/config',
    fromJson: (body) => AppConfig.fromJson(_data(body)),
  );

  /// [limit] caps both `featuredProducts` and `stores`. [group] (e.g. `food`)
  /// has the backend narrow every section to that category group.
  Future<ApiResult<HomeFeed>> getHome({int? limit, String? group}) =>
      _client.get(
        '/home',
        query: {
          if (limit != null) 'limit': limit,
          if (group != null) 'group': group,
        },
        fromJson: (body) => HomeFeed.fromJson(_data(body)),
      );

  Future<ApiResult<List<Category>>> getCategories({String? q}) => _client.get(
    '/categories',
    query: {if (q != null && q.isNotEmpty) 'q': q},
    fromJson: (body) => _list(body, Category.fromJson),
  );

  Future<ApiResult<Category>> getCategory(String id) => _client.get(
    '/categories/$id',
    fromJson: (body) => Category.fromJson(_data(body)),
  );

  Future<ApiResult<Paginated<Product>>> getProducts([
    ProductQuery query = const ProductQuery(),
  ]) => _client.get(
    '/products',
    query: query.toQuery(),
    fromJson: (body) => Paginated.fromJson(body, Product.fromJson),
  );

  /// Products of a closed store open too (`includeClosed`): the page shows
  /// them read only, `store.isOpen` tells.
  Future<ApiResult<Product>> getProduct(String id) => _client.get(
    '/products/$id',
    query: const {'includeClosed': 'true'},
    fromJson: (body) => Product.fromJson(_data(body)),
  );

  Future<ApiResult<Paginated<Store>>> getStores({
    int page = 1,
    int limit = 20,
    String? categoryId,
    String? q,
    bool? isOpen,
  }) => _client.get(
    '/stores',
    query: {
      'page': page,
      'limit': limit,
      if (categoryId != null) 'categoryId': categoryId,
      if (q != null && q.isNotEmpty) 'q': q,
      if (isOpen != null) 'isOpen': isOpen.toString(),
    },
    fromJson: (body) => Paginated.fromJson(body, Store.fromJson),
  );

  Future<ApiResult<Store>> getStore(String id) => _client.get(
    '/stores/$id',
    fromJson: (body) => Store.fromJson(_data(body)),
  );
}
