import '../../../../core/geo/geo_fix.dart';
import '../../../../core/locations/algeria_locations.dart';
import '../../../../core/locations/wilayas.dart';
import '../../../../core/models/paginated.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_result.dart';
import '../../../sales/data/models/sale_summary.dart';
import '../models/client.dart';

/// Clients of the user's scope (the API filters by sector / assigned seller).
class ClientsRepository {
  ClientsRepository(this._api);

  final ApiClient _api;

  static const pageSize = 30;

  Future<ApiResult<Paginated<ClientRow>>> list({
    String? search,
    bool debtorsOnly = false,
    String? cursor,
  }) => _api.get(
    '/clients',
    query: {
      'search': (search == null || search.trim().isEmpty)
          ? null
          : search.trim(),
      'hasDebt': debtorsOnly ? 'true' : null,
      'cursor': cursor,
      'limit': pageSize,
    },
    decode: (json) => Paginated.fromJson(
      json.asMap,
      (m) => ClientRow.fromClient(Client.fromJson(m)),
    ),
  );

  /// Clients around [fix] (GEO_CHECK), nearest first. The position goes in
  /// the body: the platform logs query strings (REPORT-35).
  Future<ApiResult<Paginated<ClientRow>>> nearby(
    GeoFix fix, {
    String? search,
    bool debtorsOnly = false,
  }) => _api.post(
    '/clients/nearby',
    data: {
      'lat': fix.lat,
      'lng': fix.lng,
      'radiusM': 5000,
      'limit': 50,
      'hasDebt': debtorsOnly,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
    },
    decode: (json) => Paginated(
      items: [for (final p in json.asList) ClientRow.fromNearby(p.asMap)],
    ),
  );

  Future<ApiResult<Client>> get(String id) =>
      _api.get('/clients/$id', decode: (json) => Client.fromJson(json.asMap));

  Future<ApiResult<List<UnpaidDocument>>> unpaidDocuments(String id) =>
      _api.get(
        '/clients/$id/unpaid-documents',
        decode: (json) => [
          for (final d in json.asList) UnpaidDocument.fromJson(d.asMap),
        ],
      );

  /// The client's latest validated sales (the API scopes a seller to his).
  Future<ApiResult<List<SaleSummary>>> lastSales(String id, {int limit = 5}) =>
      _api.get(
        '/sales',
        query: {'clientId': id, 'status': 'VALIDATED', 'limit': limit},
        decode: (json) => [
          for (final s in json.asMap['items'] as List<dynamic>)
            SaleSummary.fromJson(s as Map<String, dynamic>),
        ],
      );

  Future<ApiResult<ClientStatement>> statement(
    String id, {
    required String from,
    required String to,
  }) => _api.get(
    '/clients/$id/statement',
    query: {'from': from, 'to': to},
    decode: (json) => ClientStatement.fromJson(json.asMap),
  );

  Future<ApiResult<Client>> create(NewClient client) => _api.post(
    '/clients',
    data: client.toJson(),
    decode: (json) => Client.fromJson(json.asMap),
  );

  /// Saves the client's point. A point already set by someone else answers
  /// GEO_CHANGE_NEEDS_APPROVAL: then [requestLocation].
  Future<ApiResult<Object?>> setLocation(String id, GeoFix fix) => _api.patch(
    '/clients/$id/location',
    data: {'lat': fix.lat, 'lng': fix.lng, 'accuracyM': fix.accuracyM},
  );

  Future<ApiResult<Object?>> requestLocation(
    String id,
    GeoFix fix, {
    String? note,
  }) => _api.post(
    '/clients/$id/location-requests',
    data: {
      'lat': fix.lat,
      'lng': fix.lng,
      'accuracyM': fix.accuracyM,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    },
  );
}

/// The fields a seller fills for a new client (`createClientSchema`).
class NewClient {
  const NewClient({
    required this.code,
    required this.name,
    this.phone,
    this.address,
    this.wilaya,
    this.commune,
    this.professional = false,
  });

  final String code;
  final String name;
  final String? phone;
  final String? address;
  final Wilaya? wilaya;
  final Commune? commune;
  final bool professional;

  Map<String, dynamic> toJson() => {
    'code': code.trim(),
    'name': name.trim(),
    'type': professional ? 'PROFESSIONNEL' : 'PARTICULIER',
    'phone': phone?.trim() ?? '',
    'address': address?.trim() ?? '',
    // The codes are what counts; the French names fill the older text fields.
    'wilaya': wilaya?.fr ?? '',
    'commune': commune?.fr ?? '',
    'wilayaCode': ?wilaya?.code,
    'communeCode': ?commune?.code,
  };
}
