import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/features/stock_transfers/data/stock_transfers_repository.dart';
import 'package:orvynt_starter/features/stock_transfers/logic/transfer_cancel_cubit.dart';
import 'package:orvynt_starter/features/stock_transfers/ui/transfer_detail_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'transfer_fixtures.dart';

void main() {
  tearDown(() => getIt.reset());

  Map<String, dynamic> cancelled() => {
    'transfer': transferJson(
      status: 'CANCELLED',
      cancelReason: 'Erreur de camion',
    ),
    'warnings': <Object>[],
  };

  test('one key per reason; a timeout retry replays the same key', () async {
    var calls = 0;
    final adapter = fakeStockApi({
      ...baseRoutes(),
      'POST /stock-transfers/t1/cancel': (_) => ++calls == 1
          ? const FakeReply.fail(DioExceptionType.receiveTimeout)
          : FakeReply(200, cancelled()),
    });
    final c = TransferCancelCubit(
      getIt<StockTransfersRepository>(),
      transferId: 't1',
    );
    expect(await c.cancel('ab'), isFalse, reason: 'too short');
    expect(await c.cancel('Erreur de camion'), isFalse);
    expect(c.state.error!.isOffline, isTrue);
    final both = await Future.wait([
      c.cancel('Erreur de camion'),
      c.cancel('Erreur de camion'),
    ]);
    expect(both.where((ok) => ok), hasLength(1));
    final sent = adapter.sent.where((r) => r.path.endsWith('/cancel')).toList();
    expect(sent, hasLength(2));
    expect(
      sent[0].headers[IdempotencyKey.header],
      sent[1].headers[IdempotencyKey.header],
    );
    final first = c.keyFor('Erreur de camion').value;
    expect(c.keyFor('Autre motif').value, isNot(first));
    await c.close();
  });

  for (final locale in ['ar', 'fr']) {
    group('[$locale] at 360 dp', () {
      testWidgets('cancel a validated transfer with a reason', (tester) async {
        final adapter = fakeStockApi({
          ...baseRoutes(),
          'POST /stock-transfers/t1/cancel': (_) => FakeReply(200, cancelled()),
        });
        await pumpScreen(
          tester,
          const TransferDetailScreen(
            transferId: 't1',
            editPath: '/storekeeper/loads/t1/edit',
          ),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byKey(const Key('share-pdf')), findsOneWidget);
        expectNoOverflow(tester);
        await tester.tap(find.byKey(const Key('cancel-transfer')));
        await tester.pumpAndSettle();
        expectNoOverflow(tester);
        await tester.enterText(find.byType(TextField), 'Erreur de camion');
        await tester.pumpAndSettle();
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
        final body = adapter.sent
            .singleWhere((r) => r.path == '/stock-transfers/t1/cancel')
            .body;
        expect((body as Map)['reason'], 'Erreur de camion');
        expect(find.textContaining('Erreur de camion'), findsOneWidget);
        expect(find.byKey(const Key('cancel-transfer')), findsNothing);
        expectNoOverflow(tester);
        expectNoMoney(tester, figures: moneyFigures);
      });

      testWidgets('a refused cancel shows the reason, nothing changes', (
        tester,
      ) async {
        fakeStockApi({
          ...baseRoutes(),
          'POST /stock-transfers/t1/cancel': (_) => const FakeReply(409, {
            'code': 'STOCK_INSUFFICIENT',
            'message': 'Not enough stock',
            'details': {
              'productId': 'p1',
              'available': '6.000',
              'after': '-24.000',
              'requested': '30.000',
            },
          }),
        });
        await pumpScreen(
          tester,
          const TransferDetailScreen(
            transferId: 't1',
            editPath: '/storekeeper/loads/t1/edit',
          ),
          locale: locale,
          user: storekeeper(),
        );
        await tester.tap(find.byKey(const Key('cancel-transfer')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), 'Erreur de camion');
        await tester.pumpAndSettle();
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
        expect(find.textContaining('Eau minérale'), findsWidgets);
        expect(find.byKey(const Key('cancel-transfer')), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('a draft: edit or abandon', (tester) async {
        fakeStockApi({
          ...baseRoutes(),
          'GET /stock-transfers/t1': (_) =>
              FakeReply(200, transferJson(status: 'DRAFT')),
        });
        await pumpScreen(
          tester,
          const TransferDetailScreen(
            transferId: 't1',
            editPath: '/storekeeper/loads/t1/edit',
          ),
          locale: locale,
          user: storekeeper(),
        );
        expect(find.byKey(const Key('edit-draft')), findsOneWidget);
        expect(find.byKey(const Key('cancel-transfer')), findsOneWidget);
        expect(find.byKey(const Key('share-pdf')), findsNothing);
        expectNoOverflow(tester);
      });
    });
  }
}
