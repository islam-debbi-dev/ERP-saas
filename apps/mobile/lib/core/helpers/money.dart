import 'package:decimal/decimal.dart';

/// Money in the app (AGENTS §3 rule 4): never `double` or `num`. The API sends
/// amounts as strings (`Decimal(14,2)`); they are parsed into [Decimal] and
/// formatted here, mirroring `packages/shared/src/money.ts`.
///
/// Rounding is half-up (half away from zero for negatives) to 2 decimals, and
/// only when a value is sent or displayed. The phone's totals are a preview:
/// the API recomputes and the app shows the server's document after a save.
class Money {
  Money._();

  static final zero = Decimal.zero;

  /// Thousands separator: narrow no-break space (U+202F), like the web.
  static const thousandsSeparator = '\u202f';

  /// Between the amount and `DA`: a no-break space, so it never wraps.
  static const currencySpace = '\u00a0';

  /// Left-to-right isolate (U+2066 ... U+2069): keeps `1 234,50 DA` in order
  /// inside Arabic text.
  static const ltrIsolateStart = '\u2066';
  static const ltrIsolateEnd = '\u2069';

  /// An amount string of the API (`"1234.50"`). Throws on a malformed value:
  /// a DTO the app cannot read is a bug, not a zero.
  static Decimal parse(String value) => Decimal.parse(value);

  /// Like [parse] for nullable API fields.
  static Decimal? parseOrNull(String? value) =>
      value == null ? null : Decimal.parse(value);

  static Decimal round2(Decimal value) => value.round(scale: 2);

  static Decimal sum(Iterable<Decimal> values) =>
      values.fold(Decimal.zero, (a, b) => a + b);

  /// Canonical string for the API: rounded, always 2 decimals, `.` separator.
  static String toApi(Decimal value) => round2(value).toStringAsFixed(2);

  /// Display: `1 234 567,89 DA`. [currency] false for a cell whose column
  /// says DA; [isolate] false only when the text is already LTR.
  static String format(
    Decimal value, {
    bool currency = true,
    bool isolate = true,
  }) {
    final rounded = round2(value);
    final parts = rounded.abs().toStringAsFixed(2).split('.');
    final sign = rounded < Decimal.zero ? '-' : '';
    final amount = '$sign${_group(parts[0])},${parts[1]}';
    final text = currency ? '$amount${currencySpace}DA' : amount;
    return isolate ? '$ltrIsolateStart$text$ltrIsolateEnd' : text;
  }

  /// What a user types: `1 234,5`, `1234.50`, `1 234,50 DA`, `-12,3`.
  /// Accepts `,` or `.` as the decimal separator and any space as grouping.
  /// Null when it is not a valid amount (never guesses), like `parseDA`.
  static Decimal? parseInput(String input) {
    final cleaned = input
        .trim()
        .replaceFirst(RegExp(r'\s*DA$', caseSensitive: false), '')
        .replaceAll(RegExp(r'[\s\u00a0\u202f]'), '');
    if (cleaned.isEmpty) return null;
    if (!RegExp(r'^-?\d+([.,]\d+)?$').hasMatch(cleaned)) return null;
    return Decimal.parse(cleaned.replaceFirst(',', '.'));
  }

  /// [text] kept left to right inside Arabic text (a figure with its unit,
  /// `2 CRT × 960,00 DA`, `−5 %`). Parts inside should not be isolated again.
  static String ltr(String text) => '$ltrIsolateStart$text$ltrIsolateEnd';

  static String _group(String digits) {
    final out = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) out.write(thousandsSeparator);
      out.write(digits[i]);
    }
    return out.toString();
  }
}

/// Quantities: `Decimal(14,3)` in the product's base unit, as strings in the
/// API. Mirrors `packages/shared/src/quantity.ts`.
class Qty {
  Qty._();

  static const decimals = 3;

  static Decimal parse(String value) => Decimal.parse(value);

  static Decimal round3(Decimal value) => value.round(scale: decimals);

  /// Canonical string for the API: rounded to 3 decimals, `.` separator.
  static String toApi(Decimal value) => round3(value).toStringAsFixed(decimals);

  static bool isWhole(Decimal value) => value.isInteger;

  /// `96 PCE`, `2,5 KG`: the quantity and its unit as one LTR run.
  static String withUnit(Decimal value, String unit) =>
      Money.ltr('${format(value, isolate: false)} $unit');

  /// Display: `1 250`, `2,5`, `0,125` (no trailing zeros), LTR-isolated.
  static String format(Decimal value, {bool isolate = true}) {
    final rounded = round3(value);
    final parts = rounded.abs().toStringAsFixed(decimals).split('.');
    final frac = parts[1].replaceFirst(RegExp(r'0+$'), '');
    final sign = rounded < Decimal.zero ? '-' : '';
    final text =
        '$sign${Money._group(parts[0])}${frac.isEmpty ? '' : ',$frac'}';
    return isolate
        ? '${Money.ltrIsolateStart}$text${Money.ltrIsolateEnd}'
        : text;
  }
}

/// Packaging units ↔ the base unit, with `factorToBase` of `ProductUnitDto`
/// (e.g. 1 carton = 24 pièces).
class UnitConversion {
  UnitConversion._();

  /// Quantity typed in a packaging unit → base unit: 2 cartons × 24 = 48.
  static Decimal toBase(Decimal quantity, Decimal factorToBase) =>
      Qty.round3(quantity * factorToBase);

  /// Base quantity → packaging unit: 48 pièces / 24 = 2 cartons.
  static Decimal fromBase(Decimal quantityBase, Decimal factorToBase) {
    if (factorToBase <= Decimal.zero) {
      throw RangeError('factorToBase must be > 0');
    }
    return (quantityBase / factorToBase)
        .toDecimal(
          scaleOnInfinitePrecision: Qty.decimals,
          toBigInt: (r) => r.round(),
        )
        .round(scale: Qty.decimals);
  }
}
