import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/map/app_map.dart';
import 'package:orvynt_starter/core/map/client_map_repository.dart';
import 'package:orvynt_starter/core/map/client_map_sheet.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/router/role_screens.dart';
import 'package:orvynt_starter/features/controls/data/controls_repository.dart';
import 'package:orvynt_starter/features/controls/ui/control_maps.dart';
import 'package:orvynt_starter/features/controls/ui/controls_screen.dart';
import 'package:orvynt_starter/features/controls/ui/team_clients_map_screen.dart';
import 'package:orvynt_starter/features/team/data/team_repository.dart';

import '../../core/map/map_core_test.dart' show mapPoint;
import '../../helpers/fake_adapter.dart';
import '../../helpers/fake_tiles.dart';
import '../../helpers/pump_app.dart';
import '../stock_transfers/grants_test.dart' show pumpTab;
import '../team/team_fixtures.dart';
import 'controls_test.dart' show controlsApi, flagJson, requestJson;

void main() {
  group('Contrôles map entry', () {
    setUp(() {
      getIt.registerSingleton<ControlsRepository>(
        ControlsRepository(apiWith(controlsApi())),
      );
    });
    tearDown(getIt.reset);

    for (final locale in ['ar', 'fr']) {
      testWidgets('the map action opens the team map in $locale', (
        tester,
      ) async {
        var opened = 0;
        await pumpScreen(
          tester,
          ControlsScreen(onOpenMap: () => opened++),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byIcon(Icons.map_outlined), findsOneWidget);
        await tester.tap(find.byIcon(Icons.map_outlined));
        expect(opened, 1);
        expectNoOverflow(tester);
      });
    }

    testWidgets('without GEO_CHECK there is no map entry', (tester) async {
      await pumpScreen(
        tester,
        ControlsScreen(onOpenMap: () {}),
        locale: 'fr',
        user: supervisor(features: const [Feature.mobileApp, Feature.tournees]),
      );
      expect(find.byIcon(Icons.map_outlined), findsNothing);
    });
  });

  group('mini maps', () {
    for (final locale in ['ar', 'fr']) {
      testWidgets('a location request shows both points in $locale', (
        tester,
      ) async {
        await pumpScreen(
          tester,
          Scaffold(
            body: ListView(
              children: [
                LocationRequestCard(
                  request: LocationRequest.fromJson(requestJson('r1')),
                  onDecided: () async {},
                ),
              ],
            ),
          ),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byType(LocationRequestMap), findsOneWidget);
        expect(
          find.text(locale == 'fr' ? 'Position actuelle' : 'الموقع الحالي'),
          findsOneWidget,
        );
        expect(
          find.text(locale == 'fr' ? 'Position demandée' : 'الموقع المطلوب'),
          findsOneWidget,
        );
        expectNoOverflow(tester);
      });
    }

    testWidgets('a first position shows the requested point only', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: LocationRequestMap(
            request: LocationRequest.fromJson(
              requestJson('r2', previous: false),
            ),
          ),
        ),
        locale: 'fr',
      );
      expect(find.text('Position actuelle'), findsNothing);
      expect(find.text('Position demandée'), findsOneWidget);
    });

    testWidgets('a GPS alert shows the client and the operation', (
      tester,
    ) async {
      final flag = GeoFlagItem.fromJson(flagJson('g1', 'FAR'));
      expect(flag.lat, 36.8);
      expect(flag.clientLng, 3.1);
      await pumpScreen(
        tester,
        Scaffold(body: GeoFlagMap(flag: flag)),
        locale: 'fr',
      );
      expect(find.text('Position du client'), findsOneWidget);
      expect(find.text("Lieu de l'opération"), findsOneWidget);
      expect(find.text('Opération sans position'), findsNothing);
      expectNoOverflow(tester);
    });

    testWidgets('an operation without a fix shows the client alone', (
      tester,
    ) async {
      final json = {...flagJson('g1', 'NO_SIGNAL'), 'lat': null, 'lng': null};
      await pumpScreen(
        tester,
        Scaffold(body: GeoFlagMap(flag: GeoFlagItem.fromJson(json))),
        locale: 'fr',
      );
      expect(find.text('Position du client'), findsOneWidget);
      expect(find.text('Opération sans position'), findsOneWidget);
    });

    testWidgets('no point at all, no map', (tester) async {
      final json = {
        ...flagJson('g1', 'NO_CLIENT_GPS'),
        'lat': null,
        'lng': null,
        'client': {'id': 'c1', 'code': 'CL-001', 'name': 'X'},
      };
      await pumpScreen(
        tester,
        Scaffold(body: GeoFlagMap(flag: GeoFlagItem.fromJson(json))),
        locale: 'fr',
      );
      expect(find.byType(MiniMap), findsNothing);
      expect(find.text('Position du client'), findsNothing);
    });
  });

  group('team client map', () {
    late FakeAdapter adapter;
    late Map<String, dynamic> mapJson;

    setUp(() {
      mapJson = {
        'points': [
          mapPoint(
            'c1',
            'Supérette El Baraka',
            balance: '900.00',
            lat: 36.70,
            lng: 3.00,
            sellerId: 'u1',
          ),
          mapPoint(
            'c2',
            'Épicerie du Centre',
            balance: '99000.00',
            overLimit: true,
            lat: 36.75,
            lng: 3.05,
            sellerId: 'u1',
          ),
          mapPoint('c3', 'Dépôt Est', lat: 36.80, lng: 3.10, sellerId: 'u3'),
        ],
        'truncated': false,
        'withoutLocation': 4,
      };
      adapter = FakeAdapter(
        (o) => switch (o.path) {
          '/clients/map' => FakeReply(200, mapJson),
          '/seller-sessions' => FakeReply(200, teamJson()),
          _ => const FakeReply(404, {'code': 'NOT_FOUND', 'message': 'no'}),
        },
      );
      final api = apiWith(adapter);
      getIt
        ..registerSingleton<ClientMapRepository>(ClientMapRepository(api))
        ..registerSingleton<TeamRepository>(TeamRepository(api));
    });
    tearDown(getIt.reset);

    List<Map<String, dynamic>> mapCalls() => [
      for (final r in adapter.sent)
        if (r.path == '/clients/map') r.query,
    ];

    for (final locale in ['ar', 'fr']) {
      testWidgets('the team clients with their filters in $locale', (
        tester,
      ) async {
        await pumpScreen(
          tester,
          const TeamClientsMapScreen(today: '2026-11-22'),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byKey(const ValueKey('team-c1')), findsOneWidget);
        expect(find.byKey(const ValueKey('team-c2')), findsOneWidget);
        expect(find.byKey(const ValueKey('team-c3')), findsOneWidget);
        expect(
          find.text(locale == 'fr' ? 'Tous les vendeurs' : 'كل الباعة'),
          findsOneWidget,
        );
        expect(
          find.textContaining(
            locale == 'fr' ? 'Clients sans position' : 'زبائن بدون موقع',
          ),
          findsOneWidget,
        );
        expect(mapCalls().single, isEmpty);
        expectNoOverflow(tester);
      });
    }

    testWidgets('seller, En dette and Hors plafond reach the API', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const TeamClientsMapScreen(today: '2026-11-22'),
        locale: 'fr',
        user: supervisor(),
      );
      await tester.tap(find.text('Tous les vendeurs'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Karim Vendeur'));
      await tester.pumpAndSettle();
      expect(mapCalls().last, {'assignedSellerId': 'u1'});
      expect(find.text('Karim Vendeur'), findsOneWidget); // the chip

      await tester.tap(find.text('En dette'));
      await tester.pumpAndSettle();
      expect(mapCalls().last, {'assignedSellerId': 'u1', 'hasDebt': 'true'});

      await tester.tap(find.text('Hors plafond'));
      await tester.pumpAndSettle();
      expect(mapCalls().last, {
        'assignedSellerId': 'u1',
        'hasDebt': 'true',
        'overLimit': 'true',
      });

      await tester.tap(find.text('Karim Vendeur'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Tous les vendeurs').last);
      await tester.pumpAndSettle();
      expect(mapCalls().last.containsKey('assignedSellerId'), isFalse);
      expectNoOverflow(tester);
    });

    testWidgets('above the cap it asks to zoom in', (tester) async {
      mapJson['truncated'] = true;
      await pumpScreen(
        tester,
        const TeamClientsMapScreen(today: '2026-11-22'),
        locale: 'fr',
        user: supervisor(),
      );
      expect(find.text('Zoomez pour voir tous les clients'), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('a deep link without GEO_CHECK goes back to Contrôles', (
      tester,
    ) async {
      useFakeTiles();
      final without = await pumpTab(
        tester,
        supervisor(features: const [Feature.mobileApp, Feature.tournees]),
        '/supervisor/controls',
        '/supervisor/controls/map',
      );
      expect(without.state.uri.path, '/supervisor/controls');
      expect(find.byType(TeamClientsMapScreen), findsNothing);

      final withGeo = await pumpTab(
        tester,
        supervisor(),
        '/supervisor/controls',
        '/supervisor/controls/map',
      );
      expect(withGeo.state.uri.path, '/supervisor/controls/map');
      expect(find.byType(TeamClientsMapScreen), findsOneWidget);
    });

    testWidgets('a client opens its sheet; no dashboard, no fiche', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const TeamClientsMapScreen(today: '2026-11-22'),
        locale: 'fr',
        user: supervisor(),
      );
      await tester.tap(find.byKey(const ValueKey('team-c2')));
      await tester.pumpAndSettle();
      expect(find.byType(ClientMapSheet), findsOneWidget);
      expect(find.text('Appeler'), findsOneWidget);
      expect(find.text('Naviguer'), findsOneWidget);
      // DASHBOARD_URL is empty in tests: the supervisor has no client screen.
      expect(find.text('Ouvrir la fiche'), findsNothing);
      expectNoOverflow(tester);
    });
  });

  test('the storekeeper has no screen with a map', () {
    final paths = [
      for (final t in RoleScreens.allTabsFor(Role.storekeeper)) t.path,
    ];
    expect(paths, isNot(contains('/seller/today')));
    expect(paths, isNot(contains('/livreur/deliveries')));
    expect(paths, isNot(contains('/supervisor/controls')));
    expect(paths.where((p) => p.contains('map')), isEmpty);
  });
}
