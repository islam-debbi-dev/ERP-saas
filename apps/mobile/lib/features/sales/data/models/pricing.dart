import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'pricing.g.dart';

/// `POST /pricing/preview`: how the API would price the basket now (client's
/// price level, promotions, free units). Display only: the sale is priced
/// again by the API when it is saved.
@JsonSerializable(createToJson: false)
class PricingPreview {
  const PricingPreview({
    required this.totalHt,
    required this.totalTva,
    required this.totalTtc,
    this.lines = const [],
  });

  final List<PricedLine> lines;
  @DecimalConverter()
  final Decimal totalHt;
  @DecimalConverter()
  final Decimal totalTva;
  @DecimalConverter()
  final Decimal totalTtc;

  /// The paid line of input line [index].
  PricedLine? paidLineOf(int index) {
    for (final l in lines) {
      if (l.inputIndex == index && !l.isFree) return l;
    }
    return null;
  }

  /// The free lines (UG) a promotion adds to input line [index].
  List<PricedLine> freeLinesOf(int index) => [
    for (final l in lines)
      if (l.inputIndex == index && l.isFree) l,
  ];

  factory PricingPreview.fromJson(Map<String, dynamic> json) =>
      _$PricingPreviewFromJson(json);
}

@JsonSerializable(createToJson: false)
class PricedLine {
  const PricedLine({
    required this.position,
    required this.productId,
    required this.unitId,
    required this.designation,
    required this.unitCode,
    required this.qty,
    required this.unitPriceHt,
    required this.discountPct,
    required this.tvaRate,
    required this.lineHt,
    required this.inputIndex,
    this.unitName,
    this.listPriceHt,
    this.isFree = false,
    this.promotion,
    this.freeOfPosition,
  });

  final int position;
  final String productId;
  final String unitId;
  final String designation;
  final String unitCode;
  final String? unitName;
  @DecimalConverter()
  final Decimal qty;
  @NullableDecimalConverter()
  final Decimal? listPriceHt;
  @DecimalConverter()
  final Decimal unitPriceHt;
  @DecimalConverter()
  final Decimal discountPct;
  @DecimalConverter()
  final Decimal tvaRate;
  @DecimalConverter()
  final Decimal lineHt;
  final bool isFree;
  @JsonKey(fromJson: _promo)
  final NamedPromo? promotion;
  final int? freeOfPosition;
  final int inputIndex;

  String get unitLabel => unitName ?? unitCode;

  factory PricedLine.fromJson(Map<String, dynamic> json) =>
      _$PricedLineFromJson(json);
}

class NamedPromo {
  const NamedPromo(this.id, this.name);
  final String id;
  final String name;
}

NamedPromo? _promo(Object? json) {
  if (json == null) return null;
  final m = json as Map<String, dynamic>;
  return NamedPromo(m['id'] as String, m['name'] as String);
}

/// A kind of returnable packaging (casier, palette...), `PackagingTypeDto`.
class PackagingType {
  const PackagingType({required this.id, required this.name});

  final String id;
  final String name;

  factory PackagingType.fromJson(Map<String, dynamic> json) =>
      PackagingType(id: json['id'] as String, name: json['name'] as String);
}
