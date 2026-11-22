import 'package:decimal/decimal.dart';

import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/idempotency_key.dart';
import '../models/pricing.dart';
import '../models/sale.dart';
import '../models/sale_summary.dart';

/// Sales of the field: price preview, van sale, my sales, packaging types,
/// and the tenant's free discount ceiling.
class SalesRepository {
  SalesRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<PricingPreview>> preview({
    required String? clientId,
    required List<Map<String, dynamic>> lines,
  }) => _api.post(
    '/pricing/preview',
    data: {'clientId': clientId, 'lines': lines},
    decode: (json) => PricingPreview.fromJson(json.asMap),
  );

  /// `POST /sales/quick` (@Idempotent): draft + validation in one call.
  Future<ApiResult<SaleResult>> quickSale(
    Map<String, dynamic> body,
    IdempotencyKey key,
  ) => _api.post(
    '/sales/quick',
    data: body,
    idempotencyKey: key,
    decode: (json) => SaleResult.fromJson(json.asMap),
  );

  Future<ApiResult<Sale>> get(String id) =>
      _api.get('/sales/$id', decode: (json) => Sale.fromJson(json.asMap));

  /// The user's sales (the API scopes a seller to his own), newest first.
  Future<ApiResult<Paginated<SaleSummary>>> list({
    String? cursor,
    String? clientId,
  }) => _api.get(
    '/sales',
    query: {'cursor': cursor, 'clientId': clientId, 'limit': 30},
    decode: (json) => Paginated.fromJson(json.asMap, SaleSummary.fromJson),
  );

  Future<ApiResult<List<PackagingType>>> packagingTypes() => _api.get(
    '/packaging-types',
    decode: (json) => [
      for (final p in json.asList) PackagingType.fromJson(p.asMap),
    ],
  );

  /// `maxDiscountPct` of the tenant: the remise anyone may give.
  Future<ApiResult<Decimal>> maxDiscountPct() => _api.get(
    '/tenant/settings',
    decode: (json) =>
        Decimal.parse(json.asMap['maxDiscountPct'] as String? ?? '0'),
  );
}
