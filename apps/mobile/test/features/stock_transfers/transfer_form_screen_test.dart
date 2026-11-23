import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/design/design.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/features/catalog/ui/product_picker_screen.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfer_form_screen.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfer_result_view.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'transfer_fixtures.dart';

/// Adds one carton of the first product through the picker.
Future<void> addFirstProduct(WidgetTester tester) async {
  await tester.tap(find.byIcon(Icons.add).first);
  await tester.pumpAndSettle();
  expect(find.byType(ProductPickerScreen), findsOneWidget);
  expect(find.byType(ProductRow), findsNWidgets(2));
  expectNoOverflow(tester);
  expectNoMoney(tester, figures: moneyFigures);
  await tester.tap(find.byType(ProductRow).first);
  await tester.pumpAndSettle();
  expect(find.byType(AddProductSheet), findsOneWidget);
  expectNoOverflow(tester);
  expectNoMoney(tester, figures: moneyFigures);
  await tester.tap(
    find.descendant(
      of: find.byType(AddProductSheet),
      matching: find.byType(AppButton),
    ),
  );
  await tester.pumpAndSettle();
  // Back to the form from the picker's bar.
  await tester.tap(find.byType(AppButton).last);
  await tester.pumpAndSettle();
}

void main() {
  tearDown(() => getIt.reset());

  for (final locale in ['ar', 'fr']) {
    group('[$locale] new chargement at 360 dp', () {
      testWidgets('lines, confirm, STOCK_INSUFFICIENT on the line', (
        tester,
      ) async {
        final adapter = fakeStockApi({
          ...baseRoutes(),
          'POST /stock-transfers': (_) =>
              FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
          'PUT /stock-transfers/t7': (_) =>
              FakeReply(200, transferJson(id: 't7', status: 'DRAFT')),
          'POST /stock-transfers/t7/validate': (_) => const FakeReply(409, {
            'code': 'STOCK_INSUFFICIENT',
            'message': 'Not enough stock',
            'details': {
              'productId': 'p1',
              'available': '3.000',
              'after': '-3.000',
              'requested': '6.000',
            },
          }),
        });
        await pumpScreen(
          tester,
          const TransferFormScreen(truckId: 'v1'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.text('CAM-01 · Hyundai HD35'), findsOneWidget);
        expect(find.text('Dépôt principal'), findsOneWidget);
        expectNoOverflow(tester);

        await addFirstProduct(tester);
        expect(find.byType(TransferLineTile), findsOneWidget);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);

        await tester.tap(find.byKey(const Key('validate')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('confirm-validate')), findsOneWidget);
        expect(find.textContaining('1 CRT'), findsOneWidget);
        expectNoOverflow(tester);
        await tester.tap(find.byKey(const Key('confirm-validate')));
        await tester.pumpAndSettle();

        expect(
          adapter.sent.where((r) => r.path == '/stock-transfers/t7/validate'),
          hasLength(1),
        );
        final tile = tester.widget<TransferLineTile>(
          find.byType(TransferLineTile),
        );
        expect(tile.short, isTrue);
        expect(find.byType(TransferResultView), findsNothing);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });

      testWidgets('validated: the TR number, then Terminé', (tester) async {
        fakeStockApi({
          ...baseRoutes(),
          'POST /stock-transfers': (_) =>
              FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
          'POST /stock-transfers/t7/validate': (_) => FakeReply(200, {
            'transfer': transferJson(id: 't7'),
            'warnings': [
              {'productId': 'p1', 'available': '3.000', 'after': '-3.000'},
            ],
          }),
        });
        await pumpScreen(
          tester,
          const TransferFormScreen(truckId: 'v1'),
          locale: locale,
          user: storekeeper(),
        );
        await addFirstProduct(tester);
        await tester.tap(find.byKey(const Key('validate')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('confirm-validate')));
        await tester.pumpAndSettle();
        expect(find.byType(TransferResultView), findsOneWidget);
        expect(find.text('TR-2026-000031'), findsWidgets);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });
    });
  }
}
