import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../helpers/money.dart';

/// An amount `1 234,50 DA` that never wraps and stays left-to-right inside
/// Arabic text (docs/ui.md). [colorBySign] paints a debt in the error colour.
class AmountText extends StatelessWidget {
  const AmountText(
    this.value, {
    super.key,
    this.style,
    this.currency = true,
    this.colorBySign = false,
  });

  final Decimal value;
  final TextStyle? style;
  final bool currency;

  /// Positive (the client owes) in the error colour, negative in success.
  final bool colorBySign;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Color? color = style?.color;
    if (colorBySign && value > Decimal.zero) color = scheme.error;
    return Text(
      // The bold Almarai weights have no narrow no-break space (U+202F): it
      // would vanish and glue the thousands; a no-break space always draws.
      Money.format(
        value,
        currency: currency,
      ).replaceAll(Money.thousandsSeparator, Money.currencySpace),
      maxLines: 1,
      softWrap: false,
      textDirection: TextDirection.ltr,
      style: (style ?? const TextStyle()).copyWith(
        color: color,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}
