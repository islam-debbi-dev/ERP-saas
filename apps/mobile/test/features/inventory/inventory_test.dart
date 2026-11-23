import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/inventory/data/inventories_repository.dart';
import 'package:orvynt_starter/features/inventory/logic/inventory_count_cubit.dart';
import 'package:orvynt_starter/features/inventory/ui/inventories_screen.dart';
import 'package:orvynt_starter/features/inventory/ui/inventory_count_screen.dart';
import 'package:orvynt_starter/features/stock_transfers/data/stock_transfers_repository.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import '../stock_transfers/transfer_fixtures.dart';

Map<String, dynamic> inventoryJson({
  String status = 'OPEN',
  List<Map<String, dynamic>>? lines,
}) => {
  'id': 'i1',
  'number': 'INV-2026-000004',
  'status': status,
  'warehouseId': 'd1',
  'note': null,
  'createdAt': '2026-11-23T07:00:00.000Z',
  'validatedAt': status == 'VALIDATED' ? '2026-11-23T10:00:00.000Z' : null,
  'cancelledAt': null,
  'lines':
      lines ??
      [
        {
          'productId': 'p1',
          'reference': 'REF-p1',
          'designation': 'Eau minérale 1,5 L',
          'countedQtyBase': '90.000',
          'expectedQtyBase': '96.000',
          'diffQtyBase': '-6.000',
        },
      ],
};

Map<String, FakeRoute> routes({String status = 'OPEN'}) => {
  ...baseRoutes(),
  'GET /inventories': (_) => FakeReply(200, [
    {
      'id': 'i1',
      'number': 'INV-2026-000004',
      'status': 'OPEN',
      'warehouseId': 'd1',
      'lineCount': 1,
      'createdAt': '2026-11-23T07:00:00.000Z',
      'validatedAt': null,
    },
    {
      'id': 'i0',
      'number': 'INV-2026-000003',
      'status': 'VALIDATED',
      'warehouseId': 'd1',
      'lineCount': 42,
      'createdAt': '2026-11-01T07:00:00.000Z',
      'validatedAt': '2026-11-01T12:00:00.000Z',
    },
  ]),
  'GET /inventories/i1': (_) => FakeReply(200, inventoryJson(status: status)),
  'PUT /inventories/i1/lines': (_) => FakeReply(200, inventoryJson()),
  'POST /inventories/i1/validate': (_) =>
      FakeReply(200, inventoryJson(status: 'VALIDATED')),
  'POST /inventories': (_) => FakeReply(201, inventoryJson(lines: [])),
};

void main() {
  tearDown(() => getIt.reset());

  final water = Product.fromJson(productJson());
  final crt = water.unitById('u-crt')!;
  final pce = water.unitById('u-pce')!;

  InventoryCountCubit cubit({bool canValidate = false}) => InventoryCountCubit(
    getIt<InventoriesRepository>(),
    getIt<StockTransfersRepository>(),
    inventoryId: 'i1',
    canValidate: canValidate,
  );

  test('a pick adds to the count, a tap sets it, a line can go', () async {
    final adapter = fakeStockApi(routes());
    final c = cubit();
    await c.load();
    expect(c.state.lines.single.counted, Decimal.fromInt(90));
    c.add(water, crt, Decimal.one); // + 6
    c.add(water, pce, Decimal.fromInt(3)); // + 3
    expect(c.state.lines.single.counted, Decimal.fromInt(99));
    final juice = Product.fromJson(productJson(id: 'p2'));
    c.set(juice, juice.unitById('u-crt')!, Decimal.fromInt(2));
    expect(c.changesBody(), [
      {'productId': 'p1', 'unitId': 'u-pce', 'qty': '99.000'},
      {'productId': 'p2', 'unitId': 'u-pce', 'qty': '12.000'},
    ]);
    c.remove(water);
    expect(c.changesBody().first, {'productId': 'p1', 'qty': null});
    expect(await c.save(), isTrue);
    final put = adapter.sent.singleWhere((r) => r.method == 'PUT');
    expect((put.body as Map)['lines'], hasLength(2));
    expect(c.state.dirty, isFalse);
    await c.close();
  });

  test('validate: only with STOCK_ADJUST, saves first, one key', () async {
    var validates = 0;
    final adapter = fakeStockApi({
      ...routes(),
      'POST /inventories/i1/validate': (_) => ++validates == 1
          ? const FakeReply.fail(DioExceptionType.receiveTimeout)
          : FakeReply(200, inventoryJson(status: 'VALIDATED')),
    });
    final blind = cubit();
    await blind.load();
    expect(await blind.validate(), isFalse);
    expect(adapter.sent.where((r) => r.path.endsWith('/validate')), isEmpty);
    await blind.close();

    final c = cubit(canValidate: true);
    await c.load();
    c.add(water, crt, Decimal.one);
    expect(await c.validate(), isFalse); // timeout
    expect(await c.validate(), isTrue);
    expect(c.state.isOpen, isFalse);
    final v = adapter.sent.where((r) => r.path.endsWith('/validate')).toList();
    expect(v, hasLength(2));
    expect(
      v[0].headers[IdempotencyKey.header],
      v[1].headers[IdempotencyKey.header],
    );
    expect(adapter.sent.where((r) => r.method == 'PUT'), hasLength(1));
    await c.close();
  });

  test('a new count keeps its key across retries, per dépôt', () async {
    var creates = 0;
    final adapter = fakeStockApi({
      ...routes(),
      'POST /inventories': (_) => ++creates == 1
          ? const FakeReply.fail(DioExceptionType.connectionError)
          : FakeReply(201, inventoryJson(lines: [])),
    });
    final a = NewCountAction(getIt<InventoriesRepository>());
    await a.start('d1');
    await a.start('d1');
    final first = a.key.value;
    await a.start('d2');
    final posts = adapter.sent.where((r) => r.method == 'POST').toList();
    expect(posts[0].headers[IdempotencyKey.header], first);
    expect(posts[1].headers[IdempotencyKey.header], first);
    expect(posts[2].headers[IdempotencyKey.header], isNot(first));
  });

  for (final locale in ['ar', 'fr']) {
    group('[$locale] at 360 dp', () {
      testWidgets('the counts, open first; a new count', (tester) async {
        fakeStockApi(routes());
        await pumpScreen(
          tester,
          const InventoriesScreen(basePath: '/storekeeper/inventory'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byType(InventoryTile), findsNWidgets(2));
        expect(find.text('INV-2026-000004'), findsOneWidget);
        expectNoOverflow(tester);
        await tester.tap(find.byType(FloatingActionButton));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('start-count')), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('blind count: no expected, no écart, no Valider', (
        tester,
      ) async {
        fakeStockApi(routes());
        await pumpScreen(
          tester,
          const InventoryCountScreen(inventoryId: 'i1'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byType(CountLineTile), findsOneWidget);
        // 90 pièces = 15 cartons of 6.
        expect(find.textContaining('15 CRT'), findsOneWidget);
        expect(find.textContaining('16 CRT'), findsNothing); // expected 96
        expect(find.byKey(const Key('validate-count')), findsNothing);
        expect(find.byKey(const Key('save-count')), findsOneWidget);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);

        // The picker does not show the dépôt's stock either.
        await tester.tap(find.byKey(const Key('add-count')));
        await tester.pumpAndSettle();
        expect(find.textContaining('16 CRT'), findsNothing);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });

      testWidgets('with STOCK_ADJUST: expected, écart and Valider', (
        tester,
      ) async {
        fakeStockApi(routes());
        await pumpScreen(
          tester,
          const InventoryCountScreen(inventoryId: 'i1'),
          locale: locale,
          user: storekeeper(
            permissions: const [
              Permission.stockCount,
              Permission.stockTransfer,
              Permission.stockAdjust,
            ],
          ),
        );
        expect(find.textContaining('16 CRT'), findsOneWidget);
        expect(find.textContaining('-6'), findsOneWidget);
        expect(find.byKey(const Key('validate-count')), findsOneWidget);
        expectNoOverflow(tester);
        await tester.tap(find.byKey(const Key('validate-count')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('confirm-count')), findsOneWidget);
        expectNoOverflow(tester);
        await tester.tap(find.byKey(const Key('confirm-count')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('validate-count')), findsNothing);
        expectNoOverflow(tester);
      });

      testWidgets('a validated count is read only', (tester) async {
        fakeStockApi(routes(status: 'VALIDATED'));
        await pumpScreen(
          tester,
          const InventoryCountScreen(inventoryId: 'i1'),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byKey(const Key('add-count')), findsNothing);
        expect(find.byKey(const Key('save-count')), findsNothing);
        expectNoOverflow(tester);
      });
    });
  }
}
