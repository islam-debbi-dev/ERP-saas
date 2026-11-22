import 'package:decimal/decimal.dart';

import '../../../core/helpers/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/idempotency_key.dart';
import 'team_models.dart';

/// The supervisor's team day (`/seller-sessions`, phase 16) and today's
/// driver of a truck (`POST /warehouses/:id/driver`, phase 36).
///
/// The team is what the API returns: it keeps a supervisor to his team
/// (`tourneeSellerIds`). The phone never reads a member by an id it was not
/// given in that list.
class TeamRepository {
  TeamRepository(this._api);

  final ApiClient _api;

  Future<ApiResult<List<SellerDay>>> day(String date) => _api.get(
    '/seller-sessions',
    query: {'date': date},
    decode: (json) => [
      for (final d in json.asList) SellerDay.fromJson(d.asMap),
    ],
  );

  /// The member's day, found in the team list of [date]. Someone not in it
  /// (another supervisor's seller, a typed id) gets `day: null`, and no other
  /// call is made with his id.
  Future<ApiResult<MemberDay>> member(String sellerId, String date) async {
    final team = await day(date);
    switch (team) {
      case Failure(:final error):
        return Failure(error);
      case Success(:final data):
        final found = data.where((d) => d.seller.id == sellerId).firstOrNull;
        if (found == null) return Success(MemberDay(team: data));
        final sales = await salesSummary(sellerId, date);
        return Success(
          MemberDay(
            team: data,
            day: found,
            sales: sales is Success<SalesSummary> ? sales.data : null,
          ),
        );
    }
  }

  /// His validated sales of the day, net of avoirs (`summary=true`).
  Future<ApiResult<SalesSummary>> salesSummary(String sellerId, String date) =>
      _api.get(
        '/sales',
        query: {
          'sellerId': sellerId,
          'validatedFrom': date,
          'validatedTo': date,
          'summary': 'true',
          'limit': 1,
        },
        decode: (json) => SalesSummary.fromJson(
          (json.asMap['summary'] as Map<String, dynamic>?) ??
              const {'count': 0, 'netTtc': '0.00'},
        ),
      );

  Future<ApiResult<SellerSession>> open(
    String sellerId,
    String date,
    IdempotencyKey key,
  ) => _api.post(
    '/seller-sessions',
    data: {'sellerId': sellerId, 'date': date},
    idempotencyKey: key,
    decode: (json) => SellerSession.fromJson(json.asMap),
  );

  Future<ApiResult<SessionCloseResult>> close(
    String sessionId, {
    required Decimal handedCash,
    String? note,
    required IdempotencyKey key,
  }) => _api.post(
    '/seller-sessions/$sessionId/close',
    data: {
      'handedCash': Money.toApi(handedCash),
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    },
    idempotencyKey: key,
    decode: (json) => SessionCloseResult.fromJson(json.asMap),
  );

  /// A correction after closing: a note, and a new count if it changed.
  Future<ApiResult<SellerSession>> adjust(
    String sessionId, {
    Decimal? handedCash,
    required String note,
    required IdempotencyKey key,
  }) => _api.post(
    '/seller-sessions/$sessionId/adjust',
    data: {
      'handedCash': handedCash == null ? null : Money.toApi(handedCash),
      'note': note.trim(),
    },
    idempotencyKey: key,
    decode: (json) => SellerSession.fromJson(json.asMap),
  );

  /// The trucks in the supervisor's reach.
  Future<ApiResult<List<TruckOption>>> trucks() => _api.get(
    '/warehouses',
    query: {'type': 'VEHICLE'},
    decode: TruckOption.listFrom,
  );

  /// [userId] drives [truckId] from now on (null = nobody). Refused while
  /// his day is open (`SESSION_OPEN_ON_VEHICLE`) or with cash collected after
  /// his clôture (`CASH_AFTER_CLOSING`).
  Future<ApiResult<DriverChange>> changeDriver(
    String truckId,
    String? userId,
    IdempotencyKey key,
  ) => _api.post(
    '/warehouses/$truckId/driver',
    data: {'userId': userId},
    idempotencyKey: key,
    decode: (json) => DriverChange.fromJson(json.asMap),
  );
}
