import 'dart:convert';

import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/stock_transfers/data/stock_transfers_repository.dart';
import 'package:orvynt_starter/features/stock_transfers/data/transfer_models.dart';
import 'package:orvynt_starter/features/stock_transfers/logic/transfer_editor_cubit.dart';
import 'package:orvynt_starter/features/stock_transfers/logic/transfer_form.dart';

import '../../helpers/fake_adapter.dart';
import 'transfer_fixtures.dart';

void main() {
  tearDown(() => getIt.reset());

  final water = Product.fromJson(productJson());
  final crt = water.unitById('u-crt')!;
  final pce = water.unitById('u-pce')!;

  String? keyOf(SentRequest r) => r.headers[IdempotencyKey.header] as String?;
  Map<String, dynamic> bodyOf(SentRequest r) =>
      (r.body is String ? jsonDecode(r.body! as String) : r.body)
          as Map<String, dynamic>;

  late FakeAdapter adapter;

  Future<TransferEditorCubit> editor(
    Map<String, Route> extra, {
    String? transferId,
  }) async {
    adapter = fakeStockApi({...baseRoutes(), ...extra});
    final c = TransferEditorCubit(
      getIt<StockTransfersRepository>(),
      form: const TransferForm(type: TransferType.load, truckId: 'v1'),
      transferId: transferId,
    );
    await c.load();
    return c;
  }

  Iterable<SentRequest> sent(FakeAdapter a, String method, String path) =>
      a.sent.where((s) => s.method == method && s.path == path);

  test('a new form takes the truck\'s dépôt and reads its stock', () async {
    final c = await editor({});
    expect(c.state.form.depotId, 'd1');
    expect(c.state.truck!.label, 'CAM-01 · Hyundai HD35');
    expect(c.state.availableFor('p1'), Decimal.fromInt(96));
    expect(c.state.availableFor('p9'), Decimal.zero);
    await c.close();
  });

  test(
    'save then validate: one draft, one validation, the TR number',
    () async {
      final c = await editor({
        'POST /stock-transfers': (_) =>
            FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
        'POST /stock-transfers/t7/validate': (_) => FakeReply(200, {
          'transfer': transferJson(id: 't7'),
          'warnings': <Object>[],
        }),
      });
      c.add(water, crt, Decimal.fromInt(5));
      expect(await c.validate(), isTrue);
      expect(c.state.result!.transfer.number, 'TR-2026-000031');
      expect(sent(adapter, 'POST', '/stock-transfers'), hasLength(1));
      expect(sent(adapter, 'PUT', '/stock-transfers/t7'), isEmpty);
      expect(
        sent(adapter, 'POST', '/stock-transfers/t7/validate'),
        hasLength(1),
      );
      // Once done, another tap does nothing.
      expect(await c.validate(), isFalse);
      expect(
        sent(adapter, 'POST', '/stock-transfers/t7/validate'),
        hasLength(1),
      );
      await c.close();
    },
  );

  test('a double tap on Valider sends one validation', () async {
    final c = await editor({
      'POST /stock-transfers': (_) =>
          FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
      'POST /stock-transfers/t7/validate': (_) => FakeReply(200, {
        'transfer': transferJson(id: 't7'),
        'warnings': <Object>[],
      }),
    });
    c.add(water, crt, Decimal.fromInt(5));
    final both = await Future.wait([c.validate(), c.validate()]);
    expect(both.where((ok) => ok), hasLength(1));
    expect(sent(adapter, 'POST', '/stock-transfers'), hasLength(1));
    expect(sent(adapter, 'POST', '/stock-transfers/t7/validate'), hasLength(1));
    await c.close();
  });

  test('a create timeout is retried with the same key and body, then the '
      'new lines go by PUT', () async {
    var creates = 0;
    final c = await editor({
      'POST /stock-transfers': (_) => ++creates == 1
          ? const FakeReply.fail(DioExceptionType.receiveTimeout)
          : FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
      'PUT /stock-transfers/t7': (_) =>
          FakeReply(200, transferJson(id: 't7', status: 'DRAFT')),
    });
    c.add(water, crt, Decimal.fromInt(5));
    expect(await c.save(), isFalse);
    expect(c.state.error!.isOffline, isTrue);
    // He adds a line before retrying.
    c.add(water, pce, Decimal.fromInt(2));
    expect(await c.save(), isTrue);
    final posts = sent(adapter, 'POST', '/stock-transfers').toList();
    expect(posts, hasLength(2));
    expect(keyOf(posts[0]), keyOf(posts[1]));
    expect(bodyOf(posts[1]), bodyOf(posts[0]));
    final put = sent(adapter, 'PUT', '/stock-transfers/t7').single;
    expect((bodyOf(put)['lines'] as List).single, {
      'productId': 'p1',
      'unitId': 'u-pce',
      'qty': '32.000',
    });
    expect(c.state.dirty, isFalse);
    await c.close();
  });

  test('a refused create lets the corrected form go with the key', () async {
    var creates = 0;
    final c = await editor({
      'POST /stock-transfers': (_) => ++creates == 1
          ? const FakeReply(400, {
              'code': 'WAREHOUSE_INVALID',
              'message': 'bad',
            })
          : FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
      'PUT /stock-transfers/t7': (_) =>
          FakeReply(200, transferJson(id: 't7', status: 'DRAFT')),
    });
    c.add(water, crt, Decimal.fromInt(5));
    expect(await c.save(), isFalse);
    await c.setDepot('d1');
    c.setNote('corrigé');
    expect(await c.save(), isTrue);
    final posts = sent(adapter, 'POST', '/stock-transfers').toList();
    expect(bodyOf(posts[1])['note'], 'corrigé');
    expect(sent(adapter, 'PUT', '/stock-transfers/t7'), isEmpty);
    await c.close();
  });

  test('STOCK_INSUFFICIENT marks the line; the retry keeps the key', () async {
    var validates = 0;
    final c = await editor({
      'POST /stock-transfers': (_) =>
          FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
      'POST /stock-transfers/t7/validate': (_) => ++validates == 1
          ? const FakeReply(409, {
              'code': 'STOCK_INSUFFICIENT',
              'message': 'Not enough stock',
              'details': {
                'productId': 'p1',
                'available': '96.000',
                'after': '-24.000',
                'requested': '120.000',
              },
            })
          : FakeReply(200, {
              'transfer': transferJson(id: 't7'),
              'warnings': <Object>[],
            }),
      'PUT /stock-transfers/t7': (_) =>
          FakeReply(200, transferJson(id: 't7', status: 'DRAFT')),
    });
    c.add(water, crt, Decimal.fromInt(20));
    expect(await c.validate(), isFalse);
    expect(c.state.shortProductId, 'p1');
    expect(c.state.error!.code, 'STOCK_INSUFFICIENT');
    expect(c.state.busy, isFalse);
    c.setLine('p1', crt, Decimal.fromInt(16));
    expect(c.state.shortProductId, isNull);
    expect(await c.validate(), isTrue);
    final v = sent(adapter, 'POST', '/stock-transfers/t7/validate').toList();
    expect(keyOf(v[0]), keyOf(v[1]));
    expect(sent(adapter, 'PUT', '/stock-transfers/t7'), hasLength(1));
    await c.close();
  });

  test('TRANSFER_NOT_DRAFT after a lost answer shows it validated', () async {
    var validated = false;
    final c = await editor({
      'POST /stock-transfers': (_) =>
          FakeReply(201, transferJson(id: 't7', status: 'DRAFT')),
      'POST /stock-transfers/t7/validate': (_) {
        validated = true;
        return const FakeReply.fail(DioExceptionType.receiveTimeout);
      },
      'PUT /stock-transfers/t7': (_) => const FakeReply(409, {
        'code': 'TRANSFER_NOT_DRAFT',
        'message': 'Only a draft can be changed',
      }),
      'GET /stock-transfers/t7': (_) => FakeReply(
        200,
        transferJson(id: 't7', status: validated ? 'VALIDATED' : 'DRAFT'),
      ),
    });
    c.add(water, crt, Decimal.fromInt(5));
    expect(await c.validate(), isFalse);
    c.step('p1', 1); // he edits after the timeout
    expect(await c.validate(), isTrue);
    expect(c.state.result!.transfer.isValidated, isTrue);
    await c.close();
  });

  test(
    'editing a draft loads its lines; a validated one shows as done',
    () async {
      final c = await editor({
        'GET /stock-transfers/t1': (_) =>
            FakeReply(200, transferJson(status: 'DRAFT')),
      }, transferId: 't1');
      expect(c.state.form.lines, hasLength(2));
      expect(c.state.dirty, isFalse);
      expect(c.state.form.lines.first.product.units, hasLength(2));
      await c.close();
      await getIt.reset();
      final done = await editor({}, transferId: 't1');
      expect(done.state.result, isNotNull);
      await done.close();
    },
  );
}
