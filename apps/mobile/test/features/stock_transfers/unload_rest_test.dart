import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/features/stock_transfers/data/stock_transfers_repository.dart';
import 'package:orvynt_starter/features/stock_transfers/data/transfer_models.dart';
import 'package:orvynt_starter/features/stock_transfers/logic/transfer_editor_cubit.dart';
import 'package:orvynt_starter/features/stock_transfers/logic/transfer_form.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfer_form_screen.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfers_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'transfer_fixtures.dart';

/// The truck's rest: 24 PCE of water (4 cartons of 6), 7 PCE of water
/// sparkling (not a whole carton), 5 PCE of juice (no carton), and a
/// product at zero.
List<Map<String, dynamic>> truckRest() => [
  levelJson(qtyBase: '24.000'),
  levelJson(productId: 'p3', designation: 'Eau gazeuse 1 L', qtyBase: '7.000'),
  levelJson(
    productId: 'p2',
    designation: "Jus d'orange 1 L",
    qtyBase: '5.000',
    pack: false,
  ),
  levelJson(productId: 'p4', designation: 'Soda', qtyBase: '0.000'),
];

void main() {
  tearDown(() => getIt.reset());

  test('the rest in cartons when whole, else in pièces', () {
    final f = TransferForm.unloadRest(
      truckId: 'v1',
      depotId: 'd1',
      truckStock: [for (final j in truckRest()) StockLevel.fromJson(j)],
    );
    expect(f.type, TransferType.unload);
    expect(f.fromId, 'v1');
    expect(f.toId, 'd1');
    expect(f.lines.map((l) => (l.unit.unitCode, l.qty)), [
      ('CRT', Decimal.fromInt(4)),
      ('PCE', Decimal.fromInt(7)),
      ('PCE', Decimal.fromInt(5)),
    ]);
    expect(f.lines.map((l) => l.qtyBase), [
      Decimal.fromInt(24),
      Decimal.fromInt(7),
      Decimal.fromInt(5),
    ]);
  });

  Map<String, FakeRoute> routes() => {
    ...baseRoutes(),
    'GET /stock': (o) => FakeReply(
      200,
      stockPageJson(
        o.queryParameters['warehouseId'] == 'v1' ? truckRest() : [],
      ),
    ),
  };

  test(
    'the cubit pre-fills from the truck and goes back to its dépôt',
    () async {
      final adapter = fakeStockApi(routes());
      final c = TransferEditorCubit(
        getIt<StockTransfersRepository>(),
        form: const TransferForm(type: TransferType.unload, truckId: 'v1'),
        unloadRest: true,
      );
      await c.load();
      expect(c.state.form.depotId, 'd1');
      expect(c.state.form.lines, hasLength(3));
      expect(c.state.availableFor('p1'), Decimal.fromInt(24));
      final stockReads = adapter.sent.where((r) => r.path == '/stock');
      expect(stockReads.last.query['warehouseId'], 'v1');
      // Lines stay editable.
      c.step('p1', -1);
      expect(c.state.form.lineOf('p1')!.qty, Decimal.fromInt(3));
      await c.close();
    },
  );

  for (final locale in ['ar', 'fr']) {
    testWidgets('[$locale] the unload form at 360 dp', (tester) async {
      fakeStockApi(routes());
      await pumpScreen(
        tester,
        const TransferFormScreen(
          type: TransferType.unload,
          truckId: 'v1',
          unloadRest: true,
        ),
        locale: locale,
        user: storekeeper(),
      );
      expect(find.text('CAM-01 · Hyundai HD35'), findsOneWidget);
      expect(find.byType(TransferLineTile), findsWidgets);
      expectNoOverflow(tester);
      await tester.scrollUntilVisible(
        find.text("Jus d'orange 1 L"),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text("Jus d'orange 1 L"), findsOneWidget);
      expectNoMoney(tester, figures: moneyFigures);
    });

    testWidgets('[$locale] the list offers "Décharger le reste"', (
      tester,
    ) async {
      fakeStockApi(routes());
      await pumpScreen(
        tester,
        const TransfersScreen(basePath: '/storekeeper/loads', canCreate: true),
        locale: locale,
        user: storekeeper(),
      );
      await tester.tap(find.byType(FloatingActionButton));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('choose-load')), findsOneWidget);
      expect(find.byKey(const Key('choose-unload')), findsOneWidget);
      expectNoOverflow(tester);
      await tester.tap(find.byKey(const Key('choose-unload')));
      await tester.pumpAndSettle();
      // No truck filter: the truck is asked.
      expect(find.text('CAM-02 · Isuzu NPR'), findsOneWidget);
      expectNoOverflow(tester);
    });
  }
}
