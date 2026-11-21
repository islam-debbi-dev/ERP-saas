import 'package:json_annotation/json_annotation.dart';

import '../../../catalog/data/models/product.dart';
import '../../../catalog/logic/customisation_rules.dart';

part 'cart_line.g.dart';

/// A product snapshot plus quantity and the client's choices (size,
/// supplements, instructions), persisted locally.
///
/// [unitPrice] is the price seen when the item was added (size + supplements)
/// — display only; the backend recomputes every price when the order is
/// placed. Lines are identified by [lineKey], not by product: an assiette
/// with camembert and one without are two lines.
@JsonSerializable(explicitToJson: true)
class CartLine {
  final String productId;
  final String name;
  final String image;
  final num unitPrice;
  final String unit;
  final num unitStep;
  final String storeId;
  final String storeName;
  final num qty;

  /// Chosen size, `null` for products without sizes.
  final String? variantId;
  final String? variantLabel;

  /// Ticked supplements and instructions.
  final List<CartOption> options;

  const CartLine({
    required this.productId,
    required this.name,
    this.image = '',
    required this.unitPrice,
    this.unit = 'piece',
    this.unitStep = 1,
    this.storeId = '',
    this.storeName = '',
    required this.qty,
    this.variantId,
    this.variantLabel,
    this.options = const [],
  });

  factory CartLine.fromProduct(Product product, num qty) => CartLine(
    productId: product.id,
    name: product.name,
    image: product.mainImage ?? '',
    unitPrice: product.finalPrice,
    unit: product.unit,
    unitStep: product.unitStep,
    storeId: product.storeId,
    storeName: product.store?.name ?? '',
    qty: qty,
  );

  /// Same key as the server: `productId|variantId|sorted optionIds`.
  String get lineKey => lineKeyOf(
    productId,
    variantId: variantId,
    optionIds: options.map((o) => o.id),
  );

  num get lineTotal => (unitPrice * qty).round();

  bool get isCustomised => variantId != null || options.isNotEmpty;

  List<CartOption> get supplements =>
      options.where((o) => !o.isInstruction).toList();

  List<CartOption> get instructions =>
      options.where((o) => o.isInstruction).toList();

  CartLine withQty(num qty) => copyWith(qty: qty);

  CartLine copyWith({
    num? qty,
    num? unitPrice,
    String? variantId,
    String? variantLabel,
    List<CartOption>? options,
  }) => CartLine(
    productId: productId,
    name: name,
    image: image,
    unitPrice: unitPrice ?? this.unitPrice,
    unit: unit,
    unitStep: unitStep,
    storeId: storeId,
    storeName: storeName,
    qty: qty ?? this.qty,
    variantId: variantId ?? this.variantId,
    variantLabel: variantLabel ?? this.variantLabel,
    options: options ?? this.options,
  );

  factory CartLine.fromJson(Map<String, dynamic> json) =>
      _$CartLineFromJson(json);

  Map<String, dynamic> toJson() => _$CartLineToJson(this);
}

/// A supplement or instruction ticked on a cart line (snapshot for display).
@JsonSerializable()
class CartOption {
  final String id;

  /// `supplement | instruction`.
  final String kind;
  final String label;
  final num price;

  const CartOption({
    required this.id,
    this.kind = 'supplement',
    required this.label,
    this.price = 0,
  });

  bool get isInstruction => kind == 'instruction';

  factory CartOption.fromJson(Map<String, dynamic> json) =>
      _$CartOptionFromJson(json);

  Map<String, dynamic> toJson() => _$CartOptionToJson(this);
}
