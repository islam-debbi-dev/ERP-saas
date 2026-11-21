/// Filters for `GET /products`. `sort` takes the backend whitelist, e.g.
/// `price`, `-price`, `-createdAt`.
class ProductQuery {
  final int page;
  final int limit;
  final String? sort;
  final String? storeId;
  final String? categoryId;

  /// Several categories at once (a tab group); ignored when [categoryId] is set.
  final List<String>? categoryIds;
  final String? q;
  final bool? onSale;
  final num? minPrice;
  final num? maxPrice;

  /// With [storeId]: also list a closed store's products (read-only menu).
  final bool includeClosed;

  /// Random order fixed by this seed (`sort` is then ignored): paging with
  /// the same seed lists every match once. Only sent when set.
  final int? randomSeed;

  const ProductQuery({
    this.page = 1,
    this.limit = 20,
    this.sort,
    this.storeId,
    this.categoryId,
    this.categoryIds,
    this.q,
    this.onSale,
    this.minPrice,
    this.maxPrice,
    this.includeClosed = false,
    this.randomSeed,
  });

  ProductQuery copyWith({int? page}) => ProductQuery(
    page: page ?? this.page,
    limit: limit,
    sort: sort,
    storeId: storeId,
    categoryId: categoryId,
    categoryIds: categoryIds,
    q: q,
    onSale: onSale,
    minPrice: minPrice,
    maxPrice: maxPrice,
    includeClosed: includeClosed,
    randomSeed: randomSeed,
  );

  Map<String, dynamic> toQuery() => {
    'page': page,
    'limit': limit,
    if (sort != null) 'sort': sort,
    if (storeId != null) 'storeId': storeId,
    if (categoryId != null) 'categoryId': categoryId,
    if (categoryId == null && categoryIds != null)
      'categoryIds': categoryIds!.join(','),
    if (q != null && q!.trim().isNotEmpty) 'q': q!.trim(),
    if (onSale == true) 'onSale': 'true',
    if (minPrice != null) 'minPrice': minPrice,
    if (maxPrice != null) 'maxPrice': maxPrice,
    if (includeClosed && storeId != null) 'includeClosed': 'true',
    if (randomSeed != null) 'randomSeed': randomSeed,
  };
}
