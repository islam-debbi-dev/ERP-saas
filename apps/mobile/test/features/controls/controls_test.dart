import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/design/design.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/features/controls/data/controls_repository.dart';
import 'package:orvynt_starter/features/controls/ui/control_maps.dart';
import 'package:orvynt_starter/features/controls/ui/controls_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import '../team/team_fixtures.dart';

final _now = DateTime.utc(2026, 11, 22, 10);

Map<String, dynamic> requestJson(
  String id, {
  bool canDecide = true,
  bool previous = true,
}) => {
  'id': id,
  'client': {
    'id': 'c1',
    'code': 'CL-001',
    'name': 'Alimentation Générale Benali et Fils Grossiste Détail',
  },
  'lat': 36.7213,
  'lng': 3.1872,
  'accuracyM': 8,
  'previous': previous ? {'lat': 36.7203, 'lng': 3.1872} : null,
  'note': 'Le client a déménagé au local d\'en face',
  'status': 'PENDING',
  'requestedBy': {'id': 'u1', 'fullName': 'Karim Vendeur'},
  'requestedAt': '2026-11-22T08:15:00.000Z',
  'decidedBy': null,
  'decidedAt': null,
  'rejectReason': null,
  'canDecide': canDecide,
};

Map<String, dynamic> flagJson(String id, String status) => {
  'id': id,
  'refType': 'SALE',
  'refId': 's1',
  'refNumber': 'BL-2026-000123',
  'user': {'id': 'u1', 'fullName': 'Karim Vendeur'},
  'client': {
    'id': 'c1',
    'code': 'CL-001',
    'name': 'Supérette El Baraka',
    'lat': 36.7,
    'lng': 3.1,
  },
  'lat': 36.8,
  'lng': 3.2,
  'accuracyM': 12,
  'isMocked': status == 'MOCKED',
  'capturedAt': '2026-11-22T09:00:00.000Z',
  'receivedAt': '2026-11-22T09:00:05.000Z',
  'distanceM': 1450,
  'status': status,
  'flags': ['LATE_SYNC'],
  'note': 'Client parti au marché',
  'reviewStatus': 'NONE',
  'reviewedBy': null,
  'reviewedAt': null,
  'reviewNote': null,
};

Map<String, dynamic> reportRowJson() => {
  'seller': {'id': 'u1', 'fullName': 'Karim Vendeur'},
  'plannedStops': 18,
  'visitedStops': 15,
  'visitRate': 0.8333,
  'visits': 16,
  'productiveVisits': 11,
  'strikeRate': 0.6875,
  'noSale': {
    'CLOSED': 2,
    'HAS_STOCK': 3,
    'NO_MONEY': 0,
    'REFUSED': 0,
    'OTHER': 0,
  },
  'orders': 6,
  'ordersTtc': '154000.00',
  'delivered': 4,
  'deliveredTtc': '98000.00',
  'shortLines': 2,
  'closings': 1,
  'ecart': '-500.00',
};

FakeAdapter controlsApi({List<Map<String, dynamic>>? requests}) =>
    FakeAdapter((o) {
      if (o.method == 'POST') {
        return FakeReply(201, {...requestJson('r1'), 'status': 'APPROVED'});
      }
      return switch (o.path) {
        '/location-requests' => FakeReply(
          200,
          requests ??
              [
                requestJson('r1'),
                requestJson('r2', canDecide: false, previous: false),
              ],
        ),
        '/geo-checks' => FakeReply(200, {
          'items': [flagJson('g1', 'FAR'), flagJson('g2', 'MOCKED')],
          'nextCursor': null,
        }),
        '/tournees/reports' => FakeReply(200, {
          'from': '2026-11-22',
          'to': '2026-11-22',
          'rows': [reportRowJson()],
          'vehicleRows': <Object>[],
        }),
        _ => const FakeReply(404, {'code': 'NOT_FOUND', 'message': 'no'}),
      };
    });

void main() {
  test('the pin move is measured between the two points', () {
    final r = LocationRequest.fromJson(requestJson('r1'));
    expect(r.movedM, closeTo(111, 2));
    expect(
      LocationRequest.fromJson(requestJson('r2', previous: false)).movedM,
      isNull,
    );
  });

  test(
    'approve and reject call their paths; reject sends the reason',
    () async {
      final api = controlsApi();
      final repo = ControlsRepository(apiWith(api));
      await repo.approve('r1');
      await repo.reject('r2', '  Mauvais client  ');
      expect(api.sent.map((s) => s.path), [
        '/location-requests/r1/approve',
        '/location-requests/r2/reject',
      ]);
      expect(api.sent.last.body, {'reason': 'Mauvais client'});
    },
  );

  test('GPS flags and the report ask for the right days', () async {
    final api = controlsApi();
    final repo = ControlsRepository(apiWith(api));
    await repo.geoFlags(from: '2026-11-16', to: '2026-11-22');
    await repo.report('2026-11-22');
    expect(api.sent[0].query['from'], '2026-11-16');
    expect(api.sent[1].query, {
      'from': '2026-11-22',
      'to': '2026-11-22',
      'by': 'seller',
    });
  });

  group('screens at 360 dp', () {
    late FakeAdapter api;
    setUp(() {
      api = controlsApi();
      getIt.registerSingleton<ControlsRepository>(
        ControlsRepository(apiWith(api)),
      );
    });
    tearDown(getIt.reset);

    for (final locale in ['ar', 'fr']) {
      testWidgets('location requests in $locale', (tester) async {
        await pumpScreen(
          tester,
          ControlsScreen(clock: () => _now),
          locale: locale,
          user: supervisor(),
        );
        // Each card has its mini map: the second one is below the fold.
        expect(
          find.byType(LocationRequestCard, skipOffstage: false),
          findsNWidgets(2),
        );
        expect(
          find.byType(LocationRequestMap, skipOffstage: false),
          findsNWidgets(2),
        );
        // canDecide: false hides both buttons of the second request.
        expect(find.byType(AppButton, skipOffstage: false), findsNWidgets(2));
        expectNoOverflow(tester);
        await tester.ensureVisible(find.byType(AppButton).last);
        await tester.pumpAndSettle();
        await tester.tap(find.byType(AppButton).last);
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsOneWidget);
        await tester.tap(find.byType(FilledButton));
        await tester.pumpAndSettle();
        expect(
          api.sent.where((s) => s.method == 'POST').single.path,
          '/location-requests/r1/approve',
        );
        expect(find.byType(SnackBar), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('reject needs a reason in $locale', (tester) async {
        await pumpScreen(
          tester,
          ControlsScreen(clock: () => _now),
          locale: locale,
          user: supervisor(),
        );
        await tester.ensureVisible(find.byType(AppButton).first);
        await tester.pumpAndSettle();
        await tester.tap(find.byType(AppButton).first);
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byType(TextField),
          'Le client n\'a pas bougé',
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byType(FilledButton));
        await tester.pumpAndSettle();
        final post = api.sent.where((s) => s.method == 'POST').single;
        expect(post.path, '/location-requests/r1/reject');
        expect(post.body, {'reason': 'Le client n\'a pas bougé'});
        expectNoOverflow(tester);
      });

      testWidgets('GPS flags are read only in $locale', (tester) async {
        await pumpScreen(
          tester,
          ControlsScreen(clock: () => _now),
          locale: locale,
          user: supervisor(),
        );
        await tester.tap(find.byType(AppChoiceChip).at(1));
        await tester.pumpAndSettle();
        expect(find.byType(GeoFlagCard, skipOffstage: false), findsNWidgets(2));
        expect(find.byType(GeoFlagMap, skipOffstage: false), findsNWidgets(2));
        // No verdict: no button at all on a flag, and no review call.
        expect(
          find.descendant(
            of: find.byType(GeoFlagCard, skipOffstage: false),
            matching: find.byWidgetPredicate(
              (w) =>
                  w is ButtonStyleButton || w is AppButton || w is IconButton,
            ),
            skipOffstage: false,
          ),
          findsNothing,
        );
        expect(api.sent.any((s) => s.path.contains('review')), isFalse);
        final call = api.sent.singleWhere((s) => s.path == '/geo-checks');
        expect(call.query['from'], '2026-11-16');
        expect(call.query['to'], '2026-11-22');
        expectNoOverflow(tester);
      });

      testWidgets('today\'s tournée report in $locale', (tester) async {
        await pumpScreen(
          tester,
          ControlsScreen(clock: () => _now),
          locale: locale,
          user: supervisor(),
        );
        await tester.tap(find.byType(AppChoiceChip).at(2));
        await tester.pumpAndSettle();
        expect(find.byType(TourneeReportCard), findsOneWidget);
        expect(find.textContaining('83 %'), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('without GEO_CHECK only the report shows in $locale', (
        tester,
      ) async {
        await pumpScreen(
          tester,
          ControlsScreen(clock: () => _now),
          locale: locale,
          user: supervisor(
            features: const [Feature.mobileApp, Feature.tournees],
          ),
        );
        expect(find.byType(AppChoiceChip), findsOneWidget);
        expect(find.byType(TourneeReportCard), findsOneWidget);
        expect(api.sent.any((s) => s.path == '/location-requests'), isFalse);
        expectNoOverflow(tester);
      });
    }
  });
}
