import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/objectives/data/objectives.dart';
import 'package:orvynt_starter/features/objectives/ui/objectives_screen.dart';
import 'package:orvynt_starter/features/objectives/ui/team_objectives_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

Map<String, dynamic> item(
  String id,
  String subjectId,
  String name, {
  bool team = false,
  String metric = 'CA_HT',
}) => {
  'targetId': id,
  'metric': metric,
  'scope': null,
  'scopeLabel': null,
  'team': team,
  'subject': {'id': subjectId, 'fullName': name},
  'achieved': '812500.00',
  'target': '1000000.00',
  'pct': '81.25',
  'thresholds': ['100'],
  'next': {'pct': '100', 'remaining': '187500.00'},
};

final teamObjectivesJson = {
  'period': '2026-11',
  'daysLeft': 9,
  'items': [
    item('t0', 'sup-1', 'Nadia Superviseur', team: true),
    item('t1', 'u1', 'Karim Vendeur'),
    item('t2', 'u1', 'Karim Vendeur', metric: 'VISITS'),
    item('t3', 'u2', 'Abdelkader Benmohamed Livreur Grossiste'),
  ],
};

void main() {
  test('targets are grouped by member, in the API order', () {
    final data = MyObjectives.fromJson(teamObjectivesJson, DateTime(2026));
    final groups = groupBySubject(data.items);
    expect(groups.map((g) => g.subjectName), [
      'Nadia Superviseur',
      'Karim Vendeur',
      'Abdelkader Benmohamed Livreur Grossiste',
    ]);
    expect(groups[1].items, hasLength(2));
  });

  group('screen at 360 dp', () {
    late FakeAdapter api;
    setUp(() {
      api = FakeAdapter((_) => FakeReply(200, teamObjectivesJson));
      getIt.registerSingleton<ObjectivesRepository>(
        ObjectivesRepository(
          ApiClient(
            dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
              ..httpClientAdapter = api,
          ),
        ),
      );
    });
    tearDown(getIt.reset);

    for (final locale in ['ar', 'fr']) {
      testWidgets('team objectives in $locale', (tester) async {
        await pumpScreen(
          tester,
          const TeamObjectivesScreen(),
          locale: locale,
          user: supervisor(),
        );
        expect(find.text('Nadia Superviseur'), findsOneWidget);
        await tester.scrollUntilVisible(
          find.text('Abdelkader Benmohamed Livreur Grossiste'),
          300,
          scrollable: find.byType(Scrollable).first,
        );
        expectNoOverflow(tester);
        expect(find.byType(ObjectiveCard), findsWidgets);
        // Read only: the only call is GET /me/objectives.
        expect(api.sent.map((s) => '${s.method} ${s.path}'), [
          'GET /me/objectives',
        ]);
        expectNoOverflow(tester);
      });
    }
  });
}
