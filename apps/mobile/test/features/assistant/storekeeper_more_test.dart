import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/router/tab_routes.dart';
import 'package:orvynt_starter/features/account/ui/account_screen.dart';
import 'package:orvynt_starter/core/components/widgets/buttons/theme_and_long.dart';

import '../../helpers/pump_app.dart';

void main() {
  for (final locale in ['ar', 'fr']) {
    testWidgets('storekeeper Plus in $locale at 360 dp', (tester) async {
      await pumpScreen(
        tester,
        Builder(
          builder: (context) => AccountScreen(menu: storekeeperMenu(context)),
        ),
        locale: locale,
        user: storekeeper(),
      );
      expect(find.byIcon(Icons.auto_awesome_outlined), findsOneWidget);
      // Account, language and theme.
      expect(find.byType(ThemeAndLangWidget), findsOneWidget);
      expectNoOverflow(tester);
      expectNoMoney(tester);
    });
  }

  testWidgets('without AI_ASSISTANT no assistant entry', (tester) async {
    await pumpScreen(
      tester,
      Builder(
        builder: (context) => AccountScreen(menu: storekeeperMenu(context)),
      ),
      locale: 'fr',
      user: storekeeper(
        features: const [Feature.mobileApp, Feature.warehouses],
      ),
    );
    expect(find.byIcon(Icons.auto_awesome_outlined), findsNothing);
  });
}
