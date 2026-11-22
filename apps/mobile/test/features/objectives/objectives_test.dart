import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/router/role_screens.dart';
import 'package:orvynt_starter/core/router/tab_routes.dart';
import 'package:orvynt_starter/features/account/ui/account_screen.dart';
import 'package:orvynt_starter/features/main_screen/ui/placeholder_tab.dart';
import 'package:orvynt_starter/features/objectives/data/objectives.dart';
import 'package:orvynt_starter/features/objectives/ui/objectives_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

final objectivesJson = {
  'period': '2026-11',
  'daysLeft': 9,
  'items': [
    {
      'targetId': 't1',
      'metric': 'CA_HT',
      'scope': null,
      'scopeLabel': 'Ifri',
      'team': false,
      'subject': {'id': 'seller-1', 'fullName': 'Karim Vendeur'},
      'achieved': '812500.00',
      'target': '1000000.00',
      'pct': '81.25',
      'thresholds': ['100'],
      'next': {'pct': '100', 'remaining': '187500.00'},
    },
    {
      'targetId': 't2',
      'metric': 'VISITS',
      'scope': null,
      'scopeLabel': null,
      'team': false,
      'subject': {'id': 'seller-1', 'fullName': 'Karim Vendeur'},
      'achieved': '130',
      'target': '120',
      'pct': '108.33',
      'thresholds': <Object>[],
      'next': null,
    },
    {
      'targetId': 't3',
      'metric': 'MARGE',
      'scope': null,
      'scopeLabel': null,
      'team': true,
      'subject': {'id': 'seller-1', 'fullName': 'Karim Vendeur'},
      'achieved': null,
      'target': null,
      'pct': null,
      'thresholds': <Object>[],
      'next': null,
    },
  ],
};

void main() {
  test('objectives decode with Decimal values; hidden ones stay null', () {
    final o = MyObjectives.fromJson(
      objectivesJson,
      DateTime.utc(2026, 11, 22, 10),
    );
    expect(o.daysLeft, 9);
    expect(o.items[0].achieved, Decimal.parse('812500'));
    expect(o.items[0].nextRemaining, Decimal.parse('187500'));
    expect(o.items[2].achieved, isNull);
    expect(o.items[2].team, isTrue);
  });

  test('progress is clamped to 0..1 and values read as their metric', () {
    expect(Objective.progress(null), 0);
    expect(Objective.progress(Decimal.parse('-3')), 0);
    expect(Objective.progress(Decimal.parse('81.25')), closeTo(0.8125, 1e-9));
    expect(Objective.progress(Decimal.parse('108.33')), 1);
    expect(
      Objective.formatValue('CA_HT', Decimal.parse('1000')),
      contains('DA'),
    );
    expect(
      Objective.formatValue('VISITS', Decimal.parse('130')),
      contains('130'),
    );
    expect(
      Objective.formatValue('STRIKE_RATE', Decimal.parse('62.5')),
      contains('%'),
    );
  });

  group('screens', () {
    setUp(() {
      final dio = Dio(
        BaseOptions(baseUrl: 'http://api.test'),
      )..httpClientAdapter = FakeAdapter((_) => FakeReply(200, objectivesJson));
      getIt.registerSingleton<ObjectivesRepository>(
        ObjectivesRepository(ApiClient(dio: dio)),
      );
    });
    tearDown(() => getIt.reset());

    for (final locale in ['ar', 'fr']) {
      testWidgets('objectives at 360 dp in $locale', (tester) async {
        await pumpScreen(tester, const ObjectivesScreen(), locale: locale);
        expect(find.byType(ObjectiveCard), findsWidgets);
        expectNoOverflow(tester);
      });
    }

    testWidgets('the Plus menu follows modules and rights', (tester) async {
      await pumpScreen(
        tester,
        Builder(builder: (context) => AccountScreen(menu: sellerMenu(context))),
        locale: 'fr',
      );
      expect(find.text('Objectifs'), findsOneWidget);
      expect(find.text('Mes ventes'), findsOneWidget);
      expect(find.text('Mes commandes'), findsOneWidget);
      expect(find.text('Mes versements'), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('without the modules and rights the menu keeps Mes ventes', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        Builder(builder: (context) => AccountScreen(menu: sellerMenu(context))),
        locale: 'fr',
        user: seller(
          features: const [Feature.mobileApp],
          permissions: const [],
        ),
      );
      expect(find.text('Objectifs'), findsNothing);
      expect(find.text('Mes commandes'), findsNothing);
      expect(find.text('Mes versements'), findsNothing);
      expect(find.text('Mes ventes'), findsOneWidget);
    });
  });

  test('every seller tab has its real screen (no placeholder left)', () {
    for (final tab in RoleScreens.allTabsFor(Role.seller)) {
      expect(tabPage(tab), isNot(isA<PlaceholderTab>()), reason: tab.path);
    }
  });
}
