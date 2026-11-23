import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:orvynt_starter/core/map/app_map.dart';
import 'package:orvynt_starter/core/map/client_map_repository.dart';
import 'package:orvynt_starter/core/map/client_map_sheet.dart';
import 'package:orvynt_starter/core/map/client_marker.dart';
import 'package:orvynt_starter/core/map/map_box.dart';
import 'package:orvynt_starter/core/map/navigation_links.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_result.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fake_tiles.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> mapPoint(
  String id,
  String name, {
  String balance = '0.00',
  bool overLimit = false,
  double lat = 36.7,
  double lng = 3.1,
  String? sellerId,
}) => {
  'id': id,
  'code': 'CL-$id',
  'name': name,
  'commune': 'Bab Ezzouar',
  'phone': '0550000000',
  'lat': lat,
  'lng': lng,
  'active': true,
  'balance': balance,
  'overLimit': overLimit,
  'sectorId': null,
  'assignedSellerId': sellerId,
};

void main() {
  group('navigation links', () {
    test('Android: turn-by-turn, then the directions link, then geo:', () {
      final uris = NavigationLinks.uris(
        36.7528871,
        3.0420481,
        platform: TargetPlatform.android,
      );
      expect(uris.map((u) => u.toString()), [
        'google.navigation:q=36.752887,3.042048',
        'https://www.google.com/maps/dir/?api=1&destination=36.752887,3.042048',
        'geo:36.752887,3.042048?q=36.752887,3.042048',
      ]);
    });

    test('iOS skips google.navigation; negative coordinates keep the sign', () {
      final uris = NavigationLinks.uris(
        -33.5,
        -7.25,
        platform: TargetPlatform.iOS,
      );
      expect(uris.map((u) => u.toString()), [
        'https://www.google.com/maps/dir/?api=1&destination=-33.500000,-7.250000',
        'geo:-33.500000,-7.250000?q=-33.500000,-7.250000',
      ]);
    });

    testWidgets('falls back when the first app is missing', (tester) async {
      final tried = <String>[];
      final saved = NavigationLinks.launch;
      addTearDown(() => NavigationLinks.launch = saved);
      NavigationLinks.launch = (uri) async {
        tried.add(uri.scheme);
        if (uri.scheme == 'google.navigation') throw Exception('no app');
        return uri.scheme == 'https';
      };
      late BuildContext ctx;
      await pumpScreen(
        tester,
        Builder(
          builder: (c) {
            ctx = c;
            return const SizedBox();
          },
        ),
        locale: 'fr',
      );
      await NavigationLinks.open(ctx, 36.7, 3.1);
      expect(tried.first, isNot('geo'));
      expect(tried.last, 'https');
    });
  });

  group('marker colour rule', () {
    Decimal d(String v) => Decimal.parse(v);

    test('visited wins over everything', () {
      expect(
        markerState(balance: d('900'), overLimit: true, visited: true),
        MarkerState.visited,
      );
    });
    test('over the plafond is red, debt orange, none green', () {
      expect(
        markerState(balance: d('900'), overLimit: true),
        MarkerState.overLimit,
      );
      expect(markerState(balance: d('0.01')), MarkerState.debt);
      expect(markerState(balance: d('0')), MarkerState.clear);
      expect(markerState(balance: d('-500')), MarkerState.clear);
    });
    test('each state has its colour', () {
      expect(markerColors[MarkerState.overLimit], const Color(0xFFB91C1C));
      expect(markerColors[MarkerState.debt], const Color(0xFFB45309));
      expect(markerColors[MarkerState.clear], const Color(0xFF15803D));
      expect(markerColors[MarkerState.visited], const Color(0xFF6B7280));
    });
  });

  group('view box', () {
    test('rounds outward to 2 decimals', () {
      final box = MapBox.rounded(
        south: 36.7012,
        west: 3.0499,
        north: 36.7888,
        east: 3.1101,
      )!;
      expect(box.toQuery(), {
        'minLat': '36.70',
        'minLng': '3.04',
        'maxLat': '36.79',
        'maxLng': '3.12',
      });
    });
    test('clamps to the world and refuses an empty box', () {
      final box = MapBox.rounded(south: -95, west: -200, north: 95, east: 200)!;
      expect(box.minLat, -90);
      expect(box.maxLng, 180);
      expect(MapBox.rounded(south: 90, west: 0, north: 95, east: 1), isNull);
    });
  });

  group('GET /clients/map', () {
    test('decodes Decimal balances and sends filters and box', () async {
      final adapter = FakeAdapter(
        (_) => FakeReply(200, {
          'points': [
            mapPoint('c1', 'Supérette', balance: '1234.50', overLimit: true),
          ],
          'truncated': true,
          'withoutLocation': 3,
        }),
      );
      final repo = ClientMapRepository(
        ApiClient(
          dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
            ..httpClientAdapter = adapter,
        ),
      );
      final result = await repo.map(
        filters: const ClientMapFilters(assignedSellerId: 's1', hasDebt: true),
        box: MapBox.rounded(south: 36, west: 3, north: 37, east: 4),
      );
      final data = (result as Success<ClientMapData>).data;
      expect(data.points.single.balance, Decimal.parse('1234.5'));
      expect(data.points.single.overLimit, isTrue);
      expect(data.truncated, isTrue);
      expect(data.withoutLocation, 3);
      final q = adapter.sent.single.query;
      expect(adapter.sent.single.path, '/clients/map');
      expect(q['assignedSellerId'], 's1');
      expect(q['hasDebt'], 'true');
      expect(q.containsKey('overLimit'), isFalse);
      expect(q['minLat'], '36.00');
      expect(q['maxLng'], '4.00');
      // Never the user's own position.
      expect(q.keys.where((k) => k == 'lat' || k == 'lng'), isEmpty);
    });
  });

  group('map widgets at 360 dp', () {
    for (final locale in ['ar', 'fr']) {
      testWidgets('AppMap draws tiles, credit and controls in $locale', (
        tester,
      ) async {
        FakeTileProvider.requested = 0;
        await pumpScreen(
          tester,
          Scaffold(
            body: AppMap(
              fitPoints: const [LatLng(36.7, 3.1), LatLng(36.8, 3.2)],
              layers: [
                MarkerLayer(
                  markers: [
                    Marker(
                      point: const LatLng(36.7, 3.1),
                      width: markerSize,
                      height: markerSize,
                      child: const ClientMarker(
                        state: MarkerState.debt,
                        label: 'Supérette',
                        number: 1,
                        badge: 2,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          locale: locale,
        );
        expect(FakeTileProvider.requested, greaterThan(0));
        expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
        expect(find.byIcon(Icons.my_location), findsOneWidget);
        expect(find.byIcon(Icons.fit_screen_outlined), findsOneWidget);
        expect(find.text('1'), findsOneWidget);
        expect(find.text('2'), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('the sheet shows the client and its actions in $locale', (
        tester,
      ) async {
        var opened = 0;
        await pumpScreen(
          tester,
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => showClientMapSheet(
                    context,
                    client: MapClient(
                      id: 'c1',
                      name: 'Alimentation Générale Benali et Fils Grossiste',
                      code: 'CL-001',
                      commune: 'Bab Ezzouar',
                      phone: '0550 00 00 00',
                      balance: Decimal.parse('45230.50'),
                      lat: 36.7,
                      lng: 3.1,
                    ),
                    onOpen: () => opened++,
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
          locale: locale,
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        expect(find.byType(ClientMapSheet), findsOneWidget);
        expect(find.byIcon(Icons.call_outlined), findsOneWidget);
        expect(find.byIcon(Icons.directions_outlined), findsOneWidget);
        expectNoOverflow(tester);
        await tester.tap(find.byIcon(Icons.person_outline));
        await tester.pumpAndSettle();
        expect(find.byType(ClientMapSheet), findsNothing);
        expect(opened, 1);
      });
    }

    testWidgets('no phone, no open callback: only Naviguer', (tester) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: ClientMapSheet(
            client: MapClient(
              id: 'c1',
              name: 'Épicerie',
              balance: Decimal.zero,
              lat: 36.7,
              lng: 3.1,
            ),
          ),
        ),
        locale: 'fr',
      );
      expect(find.byIcon(Icons.call_outlined), findsNothing);
      expect(find.byIcon(Icons.person_outline), findsNothing);
      expect(find.text('Naviguer'), findsOneWidget);
    });

    testWidgets('MiniMap shows its points without gestures', (tester) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: MiniMap(
            points: const [LatLng(36.7, 3.1), LatLng(36.701, 3.101)],
            layers: [
              MarkerLayer(
                markers: [
                  dotMarker(const LatLng(36.7, 3.1), mapBlue, label: 'a'),
                ],
              ),
            ],
          ),
        ),
        locale: 'fr',
      );
      expect(find.byType(FlutterMap), findsOneWidget);
      expect(find.byType(IgnorePointer), findsWidgets);
      expectNoOverflow(tester);
    });
  });
}
