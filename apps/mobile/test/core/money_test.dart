import 'package:decimal/decimal.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/helpers/money.dart';
import 'package:orvynt_starter/core/models/product_unit.dart';

Decimal d(String s) => Decimal.parse(s);

/// Narrow no-break space (grouping) and no-break space (before DA).
const nnbsp = '\u202f';
const nbsp = '\u00a0';

void main() {
  group('Money', () {
    test('formats like the web: 1 234 567,89 DA', () {
      expect(
        Money.format(d('1234567.89'), isolate: false),
        '1${nnbsp}234${nnbsp}567,89${nbsp}DA',
      );
      expect(Money.format(d('0'), isolate: false), '0,00${nbsp}DA');
      expect(Money.format(d('999'), isolate: false), '999,00${nbsp}DA');
      expect(
        Money.format(d('1000'), currency: false, isolate: false),
        '1${nnbsp}000,00',
      );
    });

    test('negative amounts keep their sign, -0 does not', () {
      expect(
        Money.format(d('-1500.5'), isolate: false),
        '-1${nnbsp}500,50${nbsp}DA',
      );
      expect(Money.format(d('-0.001'), isolate: false), '0,00${nbsp}DA');
    });

    test('rounds half-up, half away from zero for negatives', () {
      expect(Money.toApi(d('2.345')), '2.35');
      expect(Money.toApi(d('2.344')), '2.34');
      expect(Money.toApi(d('-2.345')), '-2.35');
      expect(Money.toApi(d('10')), '10.00');
    });

    test('big amounts are exact (no float)', () {
      // 0.1 + 0.2 is exactly 0.3, and 14-digit amounts keep their cents.
      expect(Money.toApi(d('0.1') + d('0.2')), '0.30');
      expect(Money.toApi(d('999999999999.99') + d('0.01')), '1000000000000.00');
      expect(Money.sum([d('1234.56'), d('0.44'), d('-235')]), d('1000'));
    });

    test('isolates the amount so it stays LTR inside Arabic', () {
      final text = Money.format(d('1250'));
      expect(text.startsWith('\u2066'), isTrue);
      expect(text.endsWith('\u2069'), isTrue);
    });

    test('parses what a user types, never guesses', () {
      expect(Money.parseInput('1 234,5'), d('1234.5'));
      expect(Money.parseInput('1234.50'), d('1234.50'));
      expect(Money.parseInput('1${nnbsp}234,50${nbsp}DA'), d('1234.50'));
      expect(Money.parseInput('-12,3'), d('-12.3'));
      expect(Money.parseInput(''), isNull);
      expect(Money.parseInput('12,3,4'), isNull);
      expect(Money.parseInput('1.234,50'), isNull);
      expect(Money.parseInput('abc'), isNull);
    });

    test('API strings parse exactly', () {
      expect(Money.parse('50000.00'), d('50000'));
      expect(Money.parseOrNull(null), isNull);
      expect(() => Money.parse('12,5'), throwsFormatException);
    });
  });

  group('Qty', () {
    test('formats without trailing zeros, grouped', () {
      expect(Qty.format(d('1250.000'), isolate: false), '1${nnbsp}250');
      expect(Qty.format(d('2.500'), isolate: false), '2,5');
      expect(Qty.format(d('0.125'), isolate: false), '0,125');
      expect(Qty.format(d('-3'), isolate: false), '-3');
    });

    test('a quantity with its unit is one LTR run', () {
      // Isolates as Dart escapes: raw bidi characters get lost in files.
      const lri = '\u2066';
      const pdi = '\u2069';
      expect(Qty.withUnit(d('96'), 'PCE'), '${lri}96 PCE$pdi');
      expect(Qty.withUnit(d('1250'), 'CRT'), '${lri}1${nnbsp}250 CRT$pdi');
      expect(Money.ltr('−5 %'), '$lri−5 %$pdi');
    });

    test('rounds to 3 decimals for the API', () {
      expect(Qty.toApi(d('1.2345')), '1.235');
      expect(Qty.toApi(d('2')), '2.000');
      expect(Qty.isWhole(d('48.000')), isTrue);
      expect(Qty.isWhole(d('1.5')), isFalse);
    });
  });

  group('UnitConversion', () {
    test('cartons to base and back', () {
      expect(UnitConversion.toBase(d('2'), d('24')), d('48'));
      expect(UnitConversion.fromBase(d('48'), d('24')), d('2'));
      expect(UnitConversion.toBase(d('1.5'), d('12')), d('18'));
    });

    test('a division that does not end rounds half-up to 3 decimals', () {
      expect(UnitConversion.fromBase(d('10'), d('3')), d('3.333'));
      expect(UnitConversion.fromBase(d('20'), d('3')), d('6.667'));
      expect(UnitConversion.fromBase(d('-20'), d('3')), d('-6.667'));
    });

    test('a zero factor is refused', () {
      expect(() => UnitConversion.fromBase(d('1'), d('0')), throwsRangeError);
    });

    test('ProductUnit reads factorToBase from the DTO string', () {
      final carton = ProductUnit.fromJson(const {
        'id': 'pu1',
        'unitId': 'u1',
        'unitCode': 'CRT',
        'unitName': 'Carton',
        'allowsDecimal': false,
        'factorToBase': '24.000',
        'barcode': null,
        'isDefaultSale': true,
        'isDefaultPurchase': false,
      });
      expect(carton.label, 'Carton');
      expect(carton.toBase(d('3')), d('72'));
      expect(carton.fromBase(d('60')), d('2.5'));
    });
  });
}
