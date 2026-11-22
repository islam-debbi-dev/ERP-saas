import 'package:decimal/decimal.dart';

import '../../../../core/models/product_unit.dart';

/// A product of the catalogue (`ProductDto` in
/// `packages/shared/src/schemas/catalog.ts`), with its units and its prices
/// per level. Quantities of stock are in the base unit.
class Product {
  const Product({
    required this.id,
    required this.reference,
    required this.designation,
    required this.baseUnitId,
    required this.tvaRate,
    this.brandName,
    this.units = const [],
    this.prices = const [],
  });

  final String id;
  final String reference;
  final String designation;
  final String? brandName;
  final String baseUnitId;
  final Decimal tvaRate;
  final List<ProductUnit> units;
  final List<ProductPrice> prices;

  /// The unit a sale starts with: the default sale unit, else the base unit.
  ProductUnit? get defaultSaleUnit {
    if (units.isEmpty) return null;
    return units.firstWhere(
      (u) => u.isDefaultSale,
      orElse: () => units.firstWhere(
        (u) => u.unitId == baseUnitId,
        orElse: () => units.first,
      ),
    );
  }

  ProductUnit? unitById(String unitId) {
    for (final u in units) {
      if (u.unitId == unitId) return u;
    }
    return null;
  }

  /// The base unit (factor 1): pièce, kg...
  ProductUnit? get baseUnit => unitById(baseUnitId);

  /// The list price HT of [unitId] at [priceLevelId], if defined.
  Decimal? priceFor(String unitId, String? priceLevelId) {
    for (final p in prices) {
      if (p.unitId == unitId && p.priceLevelId == priceLevelId) {
        return p.priceHt;
      }
    }
    return null;
  }

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as String,
    reference: json['reference'] as String,
    designation: json['designation'] as String,
    brandName: json['brandName'] as String?,
    baseUnitId: json['baseUnitId'] as String,
    tvaRate: Decimal.parse(json['tvaRate'] as String),
    units: [
      for (final u in json['units'] as List<dynamic>? ?? const [])
        ProductUnit.fromJson(u as Map<String, dynamic>),
    ],
    prices: [
      for (final p in json['prices'] as List<dynamic>? ?? const [])
        ProductPrice.fromJson(p as Map<String, dynamic>),
    ],
  );
}

class ProductPrice {
  const ProductPrice({
    required this.unitId,
    required this.priceLevelId,
    required this.priceHt,
  });

  final String unitId;
  final String priceLevelId;
  final Decimal priceHt;

  factory ProductPrice.fromJson(Map<String, dynamic> json) => ProductPrice(
    unitId: json['unitId'] as String,
    priceLevelId: json['priceLevelId'] as String,
    priceHt: Decimal.parse(json['priceHt'] as String),
  );
}

/// `GET /products/by-barcode/:code`: the product and the scanned unit.
class BarcodeMatch {
  const BarcodeMatch({required this.product, required this.unit});

  final Product product;
  final ProductUnit unit;

  factory BarcodeMatch.fromJson(Map<String, dynamic> json) => BarcodeMatch(
    product: Product.fromJson(json['product'] as Map<String, dynamic>),
    unit: ProductUnit.fromJson(json['unit'] as Map<String, dynamic>),
  );
}
