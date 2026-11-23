import 'package:decimal/decimal.dart';

import '../../../core/models/paginated.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import '../../team/data/team_models.dart';
import 'transfer_models.dart';

/// Chargements / déchargements (`/stock-transfers`, STOCK_TRANSFER +
/// WAREHOUSES), the dépôts and trucks in reach (`/warehouses`) and a dépôt's
/// quantities (`/stock`). Quantities only, never a cost.
class StockTransfersRepository {
  StockTransfersRepository(this._api);

  final ApiClient _api;

  /// At most this many pages of 100 open drafts are read (a safety cap: a
  /// dépôt has a handful).
  static const draftPages = 10;

  Future<ApiResult<Paginated<TransferSummary>>> page({
    String? warehouseId,
    String? from,
    String? to,
    String? status,
    String? cursor,
    int limit = 100,
  }) => _api.get(
    '/stock-transfers',
    query: {
      'warehouseId': warehouseId,
      'status': status,
      'from': from,
      'to': to,
      'cursor': cursor,
      'limit': limit,
    },
    decode: (json) => Paginated.fromJson(json.asMap, TransferSummary.fromJson),
  );

  /// The chargements / déchargements validated (or validated then
  /// cancelled) on [day], every page.
  Future<ApiResult<List<TransferSummary>>> validatedOn(
    String day, {
    String? warehouseId,
  }) async {
    final out = <TransferSummary>[];
    String? cursor;
    do {
      final r = await page(
        warehouseId: warehouseId,
        from: day,
        to: day,
        cursor: cursor,
      );
      switch (r) {
        case Failure(:final error):
          return ApiResult.failure(error);
        case Success(:final data):
          out.addAll(data.items.where(_onPhone));
          cursor = data.hasMore ? data.nextCursor : null;
      }
    } while (cursor != null);
    return ApiResult.success(out);
  }

  /// The open drafts, whatever their day (dates filter on `validatedAt`, which
  /// a draft has not): `status=DRAFT`, every page up to [draftPages]. The
  /// DRAFT check stays for an API older than the status filter.
  Future<ApiResult<List<TransferSummary>>> openDrafts({
    String? warehouseId,
  }) async {
    final out = <TransferSummary>[];
    String? cursor;
    for (var i = 0; i < draftPages; i++) {
      final r = await page(
        warehouseId: warehouseId,
        status: TransferStatus.draft,
        cursor: cursor,
      );
      switch (r) {
        case Failure(:final error):
          return ApiResult.failure(error);
        case Success(:final data):
          out.addAll(data.items.where((t) => t.isDraft && _onPhone(t)));
          cursor = data.hasMore ? data.nextCursor : null;
      }
      if (cursor == null) break;
    }
    return ApiResult.success(out);
  }

  /// Drafts and the day's validated transfers, for the Chargements list.
  Future<ApiResult<TransfersDay>> day(String day, {String? warehouseId}) async {
    final drafts = await openDrafts(warehouseId: warehouseId);
    if (drafts case Failure(:final error)) return ApiResult.failure(error);
    final done = await validatedOn(day, warehouseId: warehouseId);
    if (done case Failure(:final error)) return ApiResult.failure(error);
    return ApiResult.success(
      TransfersDay(
        drafts: (drafts as Success<List<TransferSummary>>).data,
        done: (done as Success<List<TransferSummary>>).data,
      ),
    );
  }

  Future<ApiResult<StockTransfer>> get(String id) => _api.get(
    '/stock-transfers/$id',
    decode: (json) => StockTransfer.fromJson(json.asMap),
  );

  /// A draft (no effect on stock). [key] is the form's: a retry with the
  /// same body replays the first answer.
  Future<ApiResult<StockTransfer>> create(
    Map<String, dynamic> body, {
    required IdempotencyKey key,
  }) => _api.post(
    '/stock-transfers',
    data: body,
    idempotencyKey: key,
    decode: (json) => StockTransfer.fromJson(json.asMap),
  );

  /// Replaces the whole draft (header and lines).
  Future<ApiResult<StockTransfer>> update(
    String id,
    Map<String, dynamic> body,
  ) => _api.put(
    '/stock-transfers/$id',
    data: body,
    decode: (json) => StockTransfer.fromJson(json.asMap),
  );

  /// Moves the goods; numbered `TR-YYYY-…`.
  Future<ApiResult<TransferResult>> validate(
    String id, {
    required IdempotencyKey key,
  }) => _api.post(
    '/stock-transfers/$id/validate',
    idempotencyKey: key,
    decode: (json) => TransferResult.fromJson(json.asMap),
  );

  /// Abandons a draft, or moves a validated transfer's goods back.
  Future<ApiResult<TransferResult>> cancel(
    String id, {
    required String reason,
    required IdempotencyKey key,
  }) => _api.post(
    '/stock-transfers/$id/cancel',
    data: {'reason': reason},
    idempotencyKey: key,
    decode: (json) => TransferResult.fromJson(json.asMap),
  );

  /// The dépôts in reach (not the trucks), the default one first.
  Future<ApiResult<List<DepotOption>>> depots() =>
      _api.get('/warehouses', decode: DepotOption.listFrom);

  /// The live trucks in reach, with today's driver.
  Future<ApiResult<List<TruckOption>>> trucks() => _api.get(
    '/warehouses',
    query: {'type': 'VEHICLE'},
    decode: TruckOption.listFrom,
  );

  /// Every product's quantity in [warehouseId] (up to [maxPages] × 100).
  /// [positiveOnly] keeps what is really there (a truck's rest).
  Future<ApiResult<List<StockLevel>>> levels(
    String warehouseId, {
    int maxPages = 10,
    bool positiveOnly = false,
  }) async {
    final out = <StockLevel>[];
    String? cursor;
    for (var i = 0; i < maxPages; i++) {
      final r = await _api.get(
        '/stock',
        query: {'warehouseId': warehouseId, 'cursor': cursor, 'limit': 100},
        decode: (json) => Paginated.fromJson(json.asMap, StockLevel.fromJson),
      );
      switch (r) {
        case Failure(:final error):
          return ApiResult.failure(error);
        case Success(:final data):
          out.addAll(
            positiveOnly
                ? data.items.where((l) => l.qtyBase > Decimal.zero)
                : data.items,
          );
          cursor = data.hasMore ? data.nextCursor : null;
      }
      if (cursor == null) break;
    }
    return ApiResult.success(out);
  }

  static bool _onPhone(TransferSummary t) =>
      TransferType.onPhone.contains(t.type);
}

/// The Chargements list of one day: open drafts first, then what was
/// validated that day (cancelled ones included, marked).
class TransfersDay {
  const TransfersDay({required this.drafts, required this.done});

  final List<TransferSummary> drafts;
  final List<TransferSummary> done;

  bool get isEmpty => drafts.isEmpty && done.isEmpty;

  /// The trucks met in the list, for the filter chips.
  List<TransferPlace> get trucks {
    final seen = <String, TransferPlace>{};
    for (final t in [...drafts, ...done]) {
      seen.putIfAbsent(t.truck.id, () => t.truck);
    }
    return seen.values.toList(growable: false);
  }
}
