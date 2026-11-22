import 'package:decimal/decimal.dart';

import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../models/product.dart';

/// Products, barcode lookup, and the stock of one dépôt (the seller's truck).
class CatalogRepository {
  CatalogRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<Paginated<Product>>> products({
    String? search,
    String? warehouseId,
    String? cursor,
  }) => _api.get(
    '/products',
    query: {
      'search': (search == null || search.trim().isEmpty)
          ? null
          : search.trim(),
      'warehouseId': warehouseId,
      'cursor': cursor,
      'limit': 30,
    },
    decode: (json) => Paginated.fromJson(json.asMap, Product.fromJson),
  );

  Future<ApiResult<BarcodeMatch>> byBarcode(String code) => _api.get(
    '/products/by-barcode/${Uri.encodeComponent(code)}',
    decode: (json) => BarcodeMatch.fromJson(json.asMap),
  );

  /// Base quantity per product in [warehouseId]. Only quantities are read
  /// (the API hides costs without VIEW_COST_AND_MARGIN; the app never shows
  /// them). Reads up to [maxPages] pages of 100.
  Future<ApiResult<Map<String, Decimal>>> stockOf(
    String warehouseId, {
    int maxPages = 10,
  }) async {
    final out = <String, Decimal>{};
    String? cursor;
    for (var page = 0; page < maxPages; page++) {
      final result = await _api.get(
        '/stock',
        query: {'warehouseId': warehouseId, 'cursor': cursor, 'limit': 100},
        decode: (json) => json.asMap,
      );
      switch (result) {
        case Failure(:final error):
          return ApiResult.failure(error);
        case Success(:final data):
          for (final row in data['items'] as List<dynamic>) {
            final m = row as Map<String, dynamic>;
            out[m['productId'] as String] = Decimal.parse(
              m['qtyBase'] as String,
            );
          }
          cursor = data['nextCursor'] as String?;
      }
      if (cursor == null) break;
    }
    return ApiResult.success(out);
  }
}
