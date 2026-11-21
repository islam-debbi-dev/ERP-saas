import 'package:decimal/decimal.dart';

import '../helpers/money.dart';

/// A sale / purchase unit of a product (`ProductUnitDto` in
/// `packages/shared/src/schemas/catalog.ts`): cartons, pièces, kg...
class ProductUnit {
  const ProductUnit({
    required this.id,
    required this.unitId,
    required this.unitCode,
    required this.factorToBase,
    this.unitName,
    this.allowsDecimal = false,
    this.barcode,
    this.isDefaultSale = false,
    this.isDefaultPurchase = false,
  });

  final String id;
  final String unitId;
  final String unitCode;
  final String? unitName;
  final bool allowsDecimal;

  /// How many base units one of this unit holds (1 for the base unit).
  final Decimal factorToBase;
  final String? barcode;
  final bool isDefaultSale;
  final bool isDefaultPurchase;

  String get label => unitName ?? unitCode;

  /// [quantity] of this unit in the base unit.
  Decimal toBase(Decimal quantity) =>
      UnitConversion.toBase(quantity, factorToBase);

  /// A base quantity expressed in this unit (e.g. a truck's stock in cartons).
  Decimal fromBase(Decimal quantityBase) =>
      UnitConversion.fromBase(quantityBase, factorToBase);

  factory ProductUnit.fromJson(Map<String, dynamic> json) => ProductUnit(
    id: json['id'] as String,
    unitId: json['unitId'] as String,
    unitCode: json['unitCode'] as String,
    unitName: json['unitName'] as String?,
    allowsDecimal: json['allowsDecimal'] as bool? ?? false,
    factorToBase: Qty.parse(json['factorToBase'] as String),
    barcode: json['barcode'] as String?,
    isDefaultSale: json['isDefaultSale'] as bool? ?? false,
    isDefaultPurchase: json['isDefaultPurchase'] as bool? ?? false,
  );
}
