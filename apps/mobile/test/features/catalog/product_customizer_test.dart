import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/ui/widgets/product_customizer.dart';

import 'customisation_fixtures.dart';

/// Phone-sized harness (360 px wide) with the real locale files.
Future<CustomisationController> _pump(
  WidgetTester tester,
  Product product, {
  String locale = 'en',
  void Function()? onAdd,
}) async {
  tester.view.physicalSize = const Size(360, 780);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final controller = CustomisationController(product);
  addTearDown(controller.dispose);
  // The locale JSON is read from the asset bundle with real I/O.
  await tester.runAsync(() async {
    await tester.pumpWidget(
      MaterialApp(
        locale: Locale(locale),
        supportedLocales: const [Locale('en'), Locale('ar'), Locale('fr')],
        localizationsDelegates: const [
          AppLocalizationsDelegate(),
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Directionality(
          textDirection: locale == 'ar' ? TextDirection.rtl : TextDirection.ltr,
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ProductCustomizer(controller: controller),
            ),
            bottomNavigationBar: Padding(
              padding: const EdgeInsets.all(20),
              child: CustomizerAddBar(
                controller: controller,
                enabled: true,
                onAdd: onAdd ?? () {},
              ),
            ),
          ),
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
  await tester.pumpAndSettle();
  return controller;
}

/// Text finder that ignores the narrow no-break space `formatDzd` groups digits with.
Finder _text(String pattern) => find.byWidgetPredicate(
  (w) =>
      w is Text && (w.data ?? '').replaceAll('\u202F', ' ').contains(pattern),
);

Finder _addButton() => find.byKey(const ValueKey('customizer-add'));

bool _enabled(WidgetTester tester) {
  final button = tester.widget(
    find
        .descendant(
          of: _addButton(),
          matching: find.byWidgetPredicate(
            (w) => w is ButtonStyleButton || w is InkWell,
          ),
        )
        .first,
  );
  if (button is ButtonStyleButton) return button.onPressed != null;
  return (button as InkWell).onTap != null;
}

void main() {
  testWidgets(
    'pizza: the button stays disabled until size and sauce are picked',
    (tester) async {
      var added = 0;
      final controller = await _pump(tester, pizza(), onAdd: () => added++);

      expect(find.text('Choose a size first'), findsOneWidget);
      expect(_enabled(tester), isFalse);

      await tester.tap(_text('XL · 1 100'));
      await tester.pumpAndSettle();
      expect(find.text('Choose in “Sauce”'), findsOneWidget);
      expect(_enabled(tester), isFalse);

      await tester.tap(find.text('Harissa'));
      await tester.tap(find.text('Camembert'));
      await tester.pumpAndSettle();
      expect(controller.isValid, isTrue);
      expect(_text('Add to cart · 1 200'), findsOneWidget);
      expect(_enabled(tester), isTrue);

      await tester.tap(_addButton());
      expect(added, 1);
    },
  );

  testWidgets(
    'assiette: the total follows supplements and quantity, instructions are free',
    (tester) async {
      final controller = await _pump(tester, assiette());

      expect(_text('Add to cart · 360'), findsOneWidget);
      await tester.tap(find.text('Salade'));
      await tester.tap(find.text('Sans tomate'));
      await tester.pumpAndSettle();
      expect(_text('Add to cart · 460'), findsOneWidget);

      await tester.tap(find.byTooltip('More'));
      await tester.pumpAndSettle();
      expect(controller.qty, 2);
      expect(_text('Add to cart · 920'), findsOneWidget);

      // Œuf is unavailable: tapping it changes nothing.
      await tester.tap(find.text('Œuf'));
      await tester.pumpAndSettle();
      expect(_text('Add to cart · 920'), findsOneWidget);
    },
  );

  testWidgets('renders in Arabic at 360 px without overflow', (tester) async {
    await _pump(tester, pizza(), locale: 'ar');
    expect(tester.takeException(), isNull);
    expect(find.text('اختر الحجم أولاً'), findsOneWidget);
  });
}
