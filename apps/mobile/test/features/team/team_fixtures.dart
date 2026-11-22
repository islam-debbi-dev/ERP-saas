import 'package:dio/dio.dart';
import 'package:orvynt_starter/core/network/api_client.dart';

import '../../helpers/fake_adapter.dart';

ApiClient apiWith(FakeAdapter a) => ApiClient(
  dio: Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = a,
);

Map<String, dynamic> expectedJson({
  String sales = '12500.00',
  String versements = '3000.00',
  String total = '15500.00',
}) => {'fromSales': sales, 'fromVersements': versements, 'total': total};

Map<String, dynamic> sessionJson({
  String id = 's1',
  String sellerId = 'u1',
  String name = 'Karim Vendeur',
  String status = 'OPEN',
  String? handed,
  String? ecart,
  List<Map<String, dynamic>> adjustments = const [],
}) => {
  'id': id,
  'seller': {'id': sellerId, 'fullName': name},
  'date': '2026-11-22',
  'status': status,
  'warehouse': {'id': 'v1', 'name': 'VAN-16 MXT 01'},
  'expected': expectedJson(),
  'handedCash': handed,
  'ecart': ecart,
  'note': null,
  'closedBy': status == 'CLOSED'
      ? {'id': 'sup-1', 'fullName': 'Nadia Superviseur'}
      : null,
  'closedAt': status == 'CLOSED' ? '2026-11-22T17:30:00.000Z' : null,
  'adjustments': adjustments,
};

Map<String, dynamic> dayJson(
  String id,
  String name, {
  Map<String, dynamic>? session,
  bool truck = true,
}) => {
  'seller': {'id': id, 'fullName': name},
  'date': '2026-11-22',
  'session': session,
  'expected': expectedJson(),
  'vehicle': truck ? {'id': 'v1', 'name': 'VAN-16 MXT 01'} : null,
};

/// Three members: one not opened, one open, one closed short by 500 DA.
List<Map<String, dynamic>> teamJson() => [
  dayJson('u1', 'Karim Vendeur', session: sessionJson()),
  dayJson(
    'u2',
    'Abdelkader Benmohamed Livreur Grossiste',
    session: sessionJson(
      id: 's2',
      sellerId: 'u2',
      status: 'CLOSED',
      handed: '15000.00',
      ecart: '-500.00',
    ),
  ),
  dayJson('u3', 'Samir Livreur', truck: false),
];

Map<String, dynamic> truckJson(
  String id,
  String code, {
  Map<String, dynamic>? driver,
  String activity = 'CASH_VAN',
}) => {
  'id': id,
  'name': 'Isuzu NPR',
  'type': 'VEHICLE',
  'isDefault': false,
  'active': true,
  'assignedUser': driver,
  'productCount': 4,
  'manager': null,
  'parent': null,
  'location': null,
  'code': code,
  'vehicleType': {
    'id': 't',
    'code': 'MXT',
    'name': 'MXT',
    'activity': activity,
  },
  'wilayaCode': 16,
  'plateNumber': null,
  'capacityKg': null,
};

/// A fake API for the team screens. [onPost] answers the POSTs.
FakeAdapter teamApi({
  List<Map<String, dynamic>>? team,
  FakeReply Function(RequestOptions o)? onPost,
}) => FakeAdapter((o) {
  if (o.method == 'POST' && onPost != null) return onPost(o);
  if (o.path == '/seller-sessions') {
    return FakeReply(200, team ?? teamJson());
  }
  if (o.path == '/sales') {
    return const FakeReply(200, {
      'items': <Object>[],
      'nextCursor': null,
      'summary': {
        'count': 7,
        'totalTtc': '48200.00',
        'returnsTtc': '0.00',
        'netTtc': '48200.00',
      },
    });
  }
  if (o.path == '/warehouses') {
    return FakeReply(200, [
      truckJson(
        'v1',
        'VAN-16 MXT 01',
        driver: {'id': 'u1', 'fullName': 'Karim Vendeur'},
      ),
      truckJson(
        'v2',
        'CAM-16 LIV 02',
        driver: {'id': 'u9', 'fullName': 'Yacine Chauffeur'},
        activity: 'DELIVERY',
      ),
      truckJson('v3', 'VAN-16 MXT 03'),
    ]);
  }
  return const FakeReply(404, {'code': 'NOT_FOUND', 'message': 'no'});
});
