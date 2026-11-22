import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/components/widgets/buttons/theme_and_long.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/router/tab_routes.dart';
import 'package:orvynt_starter/features/account/ui/account_screen.dart';
import 'package:orvynt_starter/features/assistant/ui/assistant_placeholder_screen.dart';

import '../../helpers/pump_app.dart';

void main() {
  for (final locale in ['ar', 'fr']) {
    testWidgets('the supervisor\'s Plus menu in $locale', (tester) async {
      await pumpScreen(
        tester,
        Builder(
          builder: (context) => AccountScreen(menu: supervisorMenu(context)),
        ),
        locale: locale,
        user: supervisor(),
      );
      expect(find.byIcon(Icons.flag_outlined), findsOneWidget);
      expect(find.byIcon(Icons.auto_awesome_outlined), findsOneWidget);
      // Language and theme stay in the account block.
      expect(find.byType(ThemeAndLangWidget), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('assistant placeholder in $locale', (tester) async {
      await pumpScreen(
        tester,
        const AssistantPlaceholderScreen(),
        locale: locale,
        user: supervisor(),
      );
      expect(find.byIcon(Icons.auto_awesome_outlined), findsOneWidget);
      expectNoOverflow(tester);
    });
  }

  testWidgets('without INCENTIVES and AI_ASSISTANT the menu is empty', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      Builder(
        builder: (context) => AccountScreen(menu: supervisorMenu(context)),
      ),
      locale: 'fr',
      user: supervisor(features: const [Feature.mobileApp, Feature.tournees]),
    );
    expect(find.byIcon(Icons.flag_outlined), findsNothing);
    expect(find.byIcon(Icons.auto_awesome_outlined), findsNothing);
    expect(find.text('Objectifs de l\'équipe'), findsNothing);
  });
}
