import 'dart:math';

import '../../../core/paging/paged_cubit.dart';
import '../../catalog/data/models/product.dart';
import '../../catalog/data/models/product_query.dart';
import '../../catalog/data/repo/catalog_repository.dart';
import '../../../core/models/paginated.dart';
import '../../../core/service/api_result.dart';

/// The random fast-food section that continues the home feed once
/// "Popular dishes" has no page left.
///
/// Each [start] picks a new seed and keeps it for every page of that run:
/// the backend (`GET /products?randomSeed=`) then lists each fast-food
/// product exactly once, in an order fixed by the seed, and `totalPages`
/// says when it ends. [clear] (pull-to-refresh) puts it back to idle; the
/// next [start] reshuffles.
class RandomProductsCubit extends PagedCubit<Product> {
  RandomProductsCubit(this._catalog, {Random? random})
    : _random = random ?? Random(),
      super(_nothing);

  final CatalogRepository _catalog;
  final Random _random;

  /// Seed of the current run; `null` while idle.
  int? get seed => _seed;
  int? _seed;

  /// Whether a run started since the last [clear].
  bool get started => _seed != null;

  /// Starts a new run over [categoryIds] with a new seed. With no fast-food
  /// category the section stays empty (and hidden).
  Future<void> start(List<String> categoryIds) {
    final seed = _seed = _random.nextInt(1 << 31);
    if (categoryIds.isEmpty) return reset(_nothing);
    final ids = [...categoryIds];
    return reset(
      (page) => _catalog.getProducts(
        ProductQuery(page: page, categoryIds: ids, randomSeed: seed),
      ),
    );
  }

  @override
  void clear() {
    _seed = null;
    super.clear();
  }

  static Future<ApiResult<Paginated<Product>>> _nothing(int page) async =>
      const ApiResult.success(
        Paginated(items: [], page: 1, limit: 20, total: 0, totalPages: 0),
      );
}
