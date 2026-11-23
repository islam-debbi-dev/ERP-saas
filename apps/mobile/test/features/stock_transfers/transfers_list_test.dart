import 'package:decimal/decimal.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/design/design.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/router/role_screens.dart';
import 'package:orvynt_starter/features/stock_transfers/data/stock_transfers_repository.dart';
import 'package:orvynt_starter/features/stock_transfers/data/transfer_models.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfer_detail_screen.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfer_widgets.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfers_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'transfer_fixtures.dart';

void main() {
  tearDown(() => getIt.reset());

  test('models decode quantities as Decimal and read no cost', () {
    final t = StockTransfer.fromJson(transferJson());
    expect(t.number, 'TR-2026-000031');
    expect(t.isLoad, isTrue);
    expect(t.truck.id, 'v1');
    expect(t.lines.first.qtyBase, Decimal.fromInt(30));
    final level = StockLevel.fromJson(levelJson());
    expect(level.qtyBase, Decimal.fromInt(96));
    expect(level.packaging!.factorToBase, Decimal.fromInt(6));
    expect(level.units.map((u) => u.unitCode), ['PCE', 'CRT']);
    final depots = DepotOption.listFrom(warehousesJson());
    expect(depots.single.id, 'd1');
  });

  test('the day keeps drafts and validated LOAD / UNLOAD only', () async {
    final adapter = fakeStockApi(baseRoutes());
    final r = await getIt<StockTransfersRepository>().day(
      '2026-11-23',
      warehouseId: 'v1',
    );
    final day = (r as dynamic).data as TransfersDay;
    expect(day.drafts.map((t) => t.id), ['t9']);
    expect(day.done.map((t) => t.id), ['t1', 't2', 't3']);
    final dated = adapter.sent.where((s) => s.query['from'] != null).single;
    expect(dated.query['to'], '2026-11-23');
    expect(dated.query['warehouseId'], 'v1');
  });

  test('drafts come from status=DRAFT, every page, with no date', () async {
    var calls = 0;
    final adapter = fakeStockApi({
      ...baseRoutes(),
      'GET /stock-transfers': (o) {
        if (o.queryParameters['status'] != 'DRAFT') {
          return FakeReply(200, {'items': [], 'nextCursor': null});
        }
        calls++;
        return FakeReply(200, {
          'items': [
            summaryJson(id: 'd$calls', status: 'DRAFT'),
            // An older API ignores the filter: the phone still keeps drafts.
            summaryJson(id: 'v$calls'),
            summaryJson(id: 'x$calls', type: 'TRANSFER', status: 'DRAFT'),
          ],
          'nextCursor': calls < 4 ? 'c$calls' : null,
        });
      },
    });
    final r = await getIt<StockTransfersRepository>().openDrafts(
      warehouseId: 'v1',
    );
    final drafts = (r as dynamic).data as List<TransferSummary>;
    expect(drafts.map((t) => t.id), ['d1', 'd2', 'd3', 'd4']);
    final sent = adapter.sent.where((s) => s.query['status'] == 'DRAFT');
    expect(sent.length, 4);
    expect(sent.every((s) => s.query['from'] == null), isTrue);
    expect(sent.last.query['cursor'], 'c3');
  });

  test('the Chargements tab needs STOCK_TRANSFER', () {
    expect(
      RoleScreens.visibleTabsFor(storekeeper()).map((t) => t.path),
      contains('/storekeeper/loads'),
    );
    final revoked = storekeeper(permissions: const [Permission.stockCount]);
    expect(
      RoleScreens.visibleTabsFor(revoked).map((t) => t.path),
      isNot(contains('/storekeeper/loads')),
    );
    expect(RoleScreens.homeFor(revoked), '/storekeeper/trucks');
  });

  for (final locale in ['ar', 'fr']) {
    group('[$locale] at 360 dp', () {
      testWidgets('list: drafts then the day, truck chips', (tester) async {
        final adapter = fakeStockApi(baseRoutes());
        await pumpScreen(
          tester,
          const TransfersScreen(basePath: '/storekeeper/loads'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byType(TransferTile), findsNWidgets(4));
        expect(find.textContaining('CAM-01'), findsOneWidget);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);

        await tester.ensureVisible(find.textContaining('CAM-01'));
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('CAM-01'));
        await tester.pumpAndSettle();
        expect(
          adapter.sent.last.query['warehouseId'],
          'v1',
          reason: 'the truck filter goes to the API',
        );
        expectNoOverflow(tester);
      });

      for (final fail in [false, true]) {
        testWidgets(fail ? 'error state' : 'empty day', (tester) async {
          fakeStockApi({
            ...baseRoutes(),
            'GET /stock-transfers': (_) => fail
                ? const FakeReply(500, {'code': 'INTERNAL', 'message': 'x'})
                : const FakeReply(200, {'items': [], 'nextCursor': null}),
          });
          await pumpScreen(
            tester,
            const TransfersScreen(basePath: '/storekeeper/loads'),
            locale: locale,
            user: storekeeper(),
          );
          expect(find.byType(TransferTile), findsNothing);
          expect(
            find.byType(fail ? AppErrorState : AppEmptyState),
            findsOneWidget,
          );
          expectNoOverflow(tester);
        });
      }

      testWidgets('detail: head and lines, no money', (tester) async {
        fakeStockApi(baseRoutes());
        await pumpScreen(
          tester,
          const TransferDetailScreen(transferId: 't1'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.text('TR-2026-000031'), findsOneWidget);
        expect(find.textContaining('Eau minérale'), findsOneWidget);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });
    });
  }
}
