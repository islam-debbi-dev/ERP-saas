import 'package:dio/dio.dart';
import 'package:orvynt_starter/core/models/paginated.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/service/api_result.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/data/models/product_query.dart';
import 'package:orvynt_starter/features/catalog/data/models/store.dart';
import 'package:orvynt_starter/features/catalog/data/repo/catalog_repository.dart';

import 'customisation_fixtures.dart';

/// A restaurant with three menu sections: pizzas (2), plates (1), drinks (1).
Store restaurant({bool isOpen = true}) => Store.fromJson({
  'id': 's1',
  'name': 'Pizza Palace',
  'address': 'Oran',
  'phone': '0555000000',
  'isOpen': isOpen,
  'openingHours': [
    for (var d = 0; d < 7; d++) {'day': d, 'open': '18:00', 'close': '23:30'},
  ],
  'categories': [
    {'id': 'pizzas', 'name': 'Pizzas', 'slug': 'pizza', 'productCount': 2},
    {
      'id': 'plates',
      'name': 'Assiettes',
      'slug': 'traditional',
      'productCount': 1,
    },
    {
      'id': 'drinks',
      'name': 'Boissons',
      'slug': 'soft-drinks',
      'productCount': 1,
    },
  ],
});

Product plain(
  String id,
  String name,
  String categoryId, {
  bool storeOpen = true,
}) => Product.fromJson({
  'id': id,
  'storeId': 's1',
  'categoryId': categoryId,
  'name': name,
  'description': '$name description',
  'price': 150,
  'finalPrice': 150,
  'store': {'id': 's1', 'name': 'Pizza Palace', 'isOpen': storeOpen},
});

/// Products by section, as `GET /products?storeId=&categoryId=` returns them.
Map<String?, List<Product>> menu({bool storeOpen = true}) {
  Product withStore(Product p, String categoryId) => Product.fromJson({
    ...p.toJson(),
    'categoryId': categoryId,
    'store': {'id': 's1', 'name': 'Pizza Palace', 'isOpen': storeOpen},
  });
  final pizzas = [
    withStore(pizza(), 'pizzas'),
    plain('p2', 'Margherita', 'pizzas', storeOpen: storeOpen),
  ];
  final plates = [withStore(assiette(), 'plates')];
  final drinks = [plain('d1', 'Hamoud', 'drinks', storeOpen: storeOpen)];
  return {
    null: [...pizzas, ...plates, ...drinks],
    'pizzas': pizzas,
    'plates': plates,
    'drinks': drinks,
  };
}

/// In-memory catalog: records the product queries it answered.
class FakeCatalogRepository extends CatalogRepository {
  FakeCatalogRepository({Store? store, Map<String?, List<Product>>? products})
    : store = store ?? restaurant(),
      products = products ?? menu(),
      super(ApiClient(dio: Dio()));

  Store store;
  final Map<String?, List<Product>> products;
  final queries = <ProductQuery>[];
  int storeCalls = 0;

  @override
  Future<ApiResult<Store>> getStore(String id) async {
    storeCalls++;
    return ApiResult.success(store);
  }

  @override
  Future<ApiResult<Paginated<Product>>> getProducts([
    ProductQuery query = const ProductQuery(),
  ]) async {
    queries.add(query);
    final items = products[query.categoryId] ?? const <Product>[];
    return ApiResult.success(
      Paginated(
        items: items,
        page: 1,
        limit: 20,
        total: items.length,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<Product>> getProduct(String id) async {
    final all = products.values.expand((p) => p);
    return ApiResult.success(all.firstWhere((p) => p.id == id));
  }
}
