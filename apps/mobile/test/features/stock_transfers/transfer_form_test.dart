import 'package:decimal/decimal.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/stock_transfers/data/transfer_models.dart';
import 'package:orvynt_starter/features/stock_transfers/logic/transfer_form.dart';

import 'transfer_fixtures.dart';

Decimal d(String v) => Decimal.parse(v);

void main() {
  final water = Product.fromJson(productJson());
  final crt = water.unitById('u-crt')!;
  final pce = water.unitById('u-pce')!;
  const empty = TransferForm(
    type: TransferType.load,
    truckId: 'v1',
    depotId: 'd1',
  );

  test('a chargement goes dépôt → truck, a déchargement truck → dépôt', () {
    expect(empty.fromId, 'd1');
    expect(empty.toId, 'v1');
    const unload = TransferForm(
      type: TransferType.unload,
      truckId: 'v1',
      depotId: 'd1',
    );
    expect(unload.fromId, 'v1');
    expect(unload.toId, 'd1');
  });

  test('the same unit adds up, on one line', () {
    final f = empty.add(water, crt, d('2')).add(water, crt, d('3'));
    expect(f.lines, hasLength(1));
    expect(f.lines.single.qty, d('5'));
    expect(f.lines.single.qtyBase, d('30')); // factorToBase 6
  });

  test('another unit turns the line into the base unit, nothing lost', () {
    final f = empty.add(water, crt, d('2')).add(water, pce, d('3'));
    final l = f.lines.single;
    expect(l.unit.unitId, 'u-pce');
    expect(l.qty, d('15'));
    expect(l.qtyBase, d('15'));
  });

  test('step, set and remove', () {
    var f = empty.add(water, crt, d('1'));
    f = f.step('p1', 1);
    expect(f.lines.single.qty, d('2'));
    f = f.step('p1', -5);
    expect(f.lines.single.qty, Decimal.zero);
    f = f.set('p1', pce, d('7'));
    expect(f.lines.single.qtyBase, d('7'));
    expect(f.remove('p1').lines, isEmpty);
  });

  test('line checks: zero, decimals on a whole unit', () {
    final zero = empty.add(water, crt, Decimal.zero);
    expect(TransferForm.issueOf(zero.lines.single), LineIssue.notPositive);
    final half = empty.add(water, crt, d('1.5'));
    expect(TransferForm.issueOf(half.lines.single), LineIssue.notWhole);
    expect(half.errors(), contains('transfer.error_lines'));
    expect(empty.errors(forValidation: true), ['transfer.error_no_lines']);
    expect(const TransferForm(type: TransferType.load).errors(), [
      'transfer.error_truck',
      'transfer.error_depot',
    ]);
  });

  test('totals stay per unit, never mixed', () {
    final juice = Product.fromJson(productJson(id: 'p2'));
    final f = empty
        .add(water, crt, d('120'))
        .add(juice, juice.unitById('u-pce')!, d('30'));
    expect(f.totalsByUnit(), {'CRT': d('120'), 'PCE': d('30')});
  });

  test('the body is the API schema, quantities as strings', () {
    final f = empty.add(water, crt, d('5')).copyWith(note: '  matin ');
    expect(f.toBody(), {
      'type': 'LOAD',
      'fromWarehouseId': 'd1',
      'toWarehouseId': 'v1',
      'note': 'matin',
      'lines': [
        {'productId': 'p1', 'unitId': 'u-crt', 'qty': '5.000'},
      ],
    });
    expect(
      f.signature,
      empty.add(water, crt, d('5')).copyWith(note: 'matin').signature,
    );
  });

  test('a saved draft comes back with its units', () {
    final t = StockTransfer.fromJson(transferJson(status: 'DRAFT'));
    final known = TransferForm.fromTransfer(t, products: {'p1': water});
    expect(known.truckId, 'v1');
    expect(known.depotId, 'd1');
    expect(known.lines.first.product.units, hasLength(2));
    expect(known.lines.first.qtyBase, d('30'));
    // Without the product, the line keeps its unit and the API's factor.
    final bare = TransferForm.fromTransfer(t);
    expect(bare.lines.first.unit.factorToBase, d('6'));
    expect(bare.lines.first.qtyBase, d('30'));
    expect(bare.signature, known.signature);
  });
}
