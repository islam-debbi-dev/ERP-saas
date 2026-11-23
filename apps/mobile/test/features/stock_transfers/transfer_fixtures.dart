import 'package:dio/dio.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/catalog/data/repo/catalog_repository.dart';
import 'package:orvynt_starter/features/stock_transfers/data/stock_transfers_repository.dart';

import '../../helpers/fake_adapter.dart';

/// Costs and prices the fixtures carry: none may ever show on a screen.
const moneyFigures = ['85,50', '8 550', '8550', '120,00', '2 880'];

Map<String, dynamic> depotJson({
  String id = 'd1',
  String name = 'Dépôt principal',
  bool isDefault = true,
}) => {
  'id': id,
  'name': name,
  'type': isDefault ? 'MAIN' : 'SECONDARY',
  'isDefault': isDefault,
  'active': true,
  'assignedUser': null,
  'productCount': 12,
  'manager': null,
  'parent': null,
  'location': null,
  'code': null,
  'vehicleType': null,
  'wilayaCode': null,
  'plateNumber': null,
  'capacityKg': null,
};

Map<String, dynamic> truckJson({
  String id = 'v1',
  String code = 'CAM-01',
  String name = 'Hyundai HD35',
  String? driver = 'Karim Vendeur',
  String parent = 'd1',
}) => {
  ...depotJson(id: id, name: name, isDefault: false),
  'type': 'VEHICLE',
  'code': code,
  'assignedUser': driver == null ? null : {'id': 'u-$id', 'fullName': driver},
  'parent': {'id': parent, 'name': 'Dépôt principal'},
  'vehicleType': {
    'id': 'vt1',
    'code': 'MXT',
    'name': 'Mixte',
    'activity': 'CASH_VAN',
  },
};

List<Map<String, dynamic>> warehousesJson() => [
  depotJson(),
  truckJson(),
  truckJson(id: 'v2', code: 'CAM-02', name: 'Isuzu NPR', driver: null),
];

Map<String, dynamic> summaryJson({
  String id = 't1',
  String type = 'LOAD',
  String status = 'VALIDATED',
  String? number = 'TR-2026-000031',
  int lineCount = 5,
}) => {
  'id': id,
  'number': status == 'DRAFT' ? null : number,
  'type': type,
  'status': status,
  'from': type == 'LOAD'
      ? {'id': 'd1', 'name': 'Dépôt principal'}
      : {'id': 'v1', 'name': 'Hyundai HD35'},
  'to': type == 'LOAD'
      ? {'id': 'v1', 'name': 'Hyundai HD35'}
      : {'id': 'd1', 'name': 'Dépôt principal'},
  'lineCount': lineCount,
  'createdAt': '2026-11-23T05:40:00.000Z',
  'validatedAt': status == 'DRAFT' ? null : '2026-11-23T06:30:00.000Z',
};

Map<String, dynamic> lineJson({
  String productId = 'p1',
  String designation = 'Eau minérale 1,5 L',
  String unitId = 'u-crt',
  String unitCode = 'CRT',
  String qty = '5.000',
  String qtyBase = '30.000',
}) => {
  'productId': productId,
  'reference': 'REF-$productId',
  'designation': designation,
  'unitId': unitId,
  'unitCode': unitCode,
  'qty': qty,
  'qtyBase': qtyBase,
};

Map<String, dynamic> transferJson({
  String id = 't1',
  String type = 'LOAD',
  String status = 'VALIDATED',
  List<Map<String, dynamic>>? lines,
  String? cancelReason,
}) {
  final s = summaryJson(id: id, type: type, status: status);
  return {
    'id': id,
    'number': s['number'],
    'type': type,
    'status': status,
    'from': {
      ...s['from'] as Map<String, dynamic>,
      'type': type == 'LOAD' ? 'MAIN' : 'VEHICLE',
    },
    'to': {
      ...s['to'] as Map<String, dynamic>,
      'type': type == 'LOAD' ? 'VEHICLE' : 'MAIN',
    },
    'note': null,
    'cancelReason': cancelReason,
    'createdBy': {'id': 'store-1', 'fullName': 'Rachid Magasinier'},
    'createdAt': s['createdAt'],
    'validatedAt': s['validatedAt'],
    'cancelledAt': status == 'CANCELLED' ? '2026-11-23T09:00:00.000Z' : null,
    'lines':
        lines ??
        [
          lineJson(),
          lineJson(
            productId: 'p2',
            designation: "Jus d'orange 1 L pack familial très long nom",
            unitId: 'u-pce',
            unitCode: 'PCE',
            qty: '12.000',
            qtyBase: '12.000',
          ),
        ],
  };
}

/// `StockLevelDto` with a cost and a value (as for a user allowed to see
/// them): the phone must never show them.
Map<String, dynamic> levelJson({
  String productId = 'p1',
  String designation = 'Eau minérale 1,5 L',
  String qtyBase = '96.000',
  bool pack = true,
}) => {
  'productId': productId,
  'reference': 'REF-$productId',
  'designation': designation,
  'baseUnitId': 'u-pce',
  'minStock': '0.000',
  'qtyBase': qtyBase,
  'avgCost': '85.50',
  'value': '8550.00',
  'lowStock': false,
  'hasOpening': true,
  'packaging': pack
      ? {
          'unitId': 'u-crt',
          'unitCode': 'CRT',
          'unitName': 'Carton',
          'factorToBase': '6',
        }
      : null,
  'baseUnit': {'unitCode': 'PCE', 'unitName': 'Pièce', 'allowsDecimal': false},
};

Map<String, dynamic> stockPageJson(List<Map<String, dynamic>> items) => {
  'items': items,
  'nextCursor': null,
  'summary': {'totalValue': '2880.00', 'lowStockCount': 0, 'productCount': 2},
};

/// `ProductDto` with prices: the picker must not show them.
Map<String, dynamic> productJson({
  String id = 'p1',
  String designation = 'Eau minérale 1,5 L',
}) => {
  'id': id,
  'reference': 'REF-$id',
  'designation': designation,
  'brandName': 'Ifri',
  'baseUnitId': 'u-pce',
  'tvaRate': '19.00',
  'units': [
    {
      'id': 'pu-$id-pce',
      'unitId': 'u-pce',
      'unitCode': 'PCE',
      'unitName': 'Pièce',
      'factorToBase': '1',
      'isDefaultSale': false,
    },
    {
      'id': 'pu-$id-crt',
      'unitId': 'u-crt',
      'unitCode': 'CRT',
      'unitName': 'Carton',
      'factorToBase': '6',
      'barcode': '6130000000017',
      'isDefaultSale': true,
    },
  ],
  'prices': [
    {'unitId': 'u-crt', 'priceLevelId': 'pl1', 'priceHt': '120.00'},
  ],
};

typedef FakeRoute = FakeReply Function(RequestOptions o);

/// A fake API answering `"<METHOD> <path>"` from [routes] (path without
/// query), 404 otherwise. Registers the repositories on it.
FakeAdapter fakeStockApi(Map<String, FakeRoute> routes) {
  final adapter = FakeAdapter((o) {
    final route = routes['${o.method} ${o.path}'];
    if (route != null) return route(o);
    return const FakeReply(404, {'code': 'NOT_FOUND', 'message': 'no route'});
  });
  final api = ApiClient(
    dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
      ..httpClientAdapter = adapter,
  );
  getIt.registerSingleton<StockTransfersRepository>(
    StockTransfersRepository(api),
  );
  getIt.registerSingleton<CatalogRepository>(CatalogRepository(api));
  return adapter;
}

/// The default routes of the Chargements screens.
Map<String, FakeRoute> baseRoutes() => {
  'GET /warehouses': (o) => FakeReply(
    200,
    o.queryParameters['type'] == 'VEHICLE'
        ? warehousesJson().where((w) => w['type'] == 'VEHICLE').toList()
        : warehousesJson(),
  ),
  'GET /stock-transfers': (o) => FakeReply(200, {
    'items': o.queryParameters['from'] == null
        ? [summaryJson(id: 't9', status: 'DRAFT'), summaryJson()]
        : [
            summaryJson(),
            summaryJson(id: 't2', type: 'UNLOAD', lineCount: 3),
            summaryJson(id: 't3', status: 'CANCELLED'),
            summaryJson(id: 't4', type: 'TRANSFER'),
          ],
    'nextCursor': null,
  }),
  'GET /stock-transfers/t1': (_) => FakeReply(200, transferJson()),
  'GET /stock': (_) => FakeReply(
    200,
    stockPageJson([
      levelJson(),
      levelJson(
        productId: 'p2',
        designation: "Jus d'orange 1 L",
        qtyBase: '12.000',
        pack: false,
      ),
    ]),
  ),
  'GET /products': (_) => FakeReply(200, {
    'items': [
      productJson(),
      productJson(id: 'p2', designation: "Jus d'orange 1 L"),
    ],
    'nextCursor': null,
  }),
};
