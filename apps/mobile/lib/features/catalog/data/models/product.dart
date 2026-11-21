import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_readers.dart';
import '../../../../core/models/media_ref.dart';

part 'product.g.dart';

/// `GET /products`, `/products/:id`, and the products embedded in `/home` and
/// `/stores/:id`.
///
/// `storeId` / `categoryId` may arrive populated; they are flattened to ids
/// here and the summary is exposed as [store] / [category]. `finalPrice` is
/// computed server-side (`price` minus `discountPercentage`, integer DZD).
@JsonSerializable(explicitToJson: true)
class Product {
  final String id;
  @JsonKey(fromJson: _requiredId)
  final String storeId;
  @JsonKey(fromJson: _requiredId)
  final String categoryId;
  final String name;
  final String? description;
  final num price;
  final num discountPercentage;
  final num finalPrice;

  /// `piece | kg | g | liter | box | pack`.
  final String unit;

  /// Quantity increment (fractional only for `kg` / `liter`).
  final num unitStep;

  /// `null` means stock is not tracked.
  final num? stock;
  final List<ProductImage> images;
  final bool isAvailable;

  @JsonKey(readValue: _readStore)
  final ProductStore? store;
  final ProductCategory? category;

  /// Sizes (only on `/products/:id`; lists send the flags below).
  final List<ProductVariant> variants;

  /// Supplements (paid) and instructions (free), only on `/products/:id`.
  final List<ProductOptionGroup> optionGroups;

  /// Lowest available size price (or [price]); `null` on old responses.
  final num? priceFrom;
  final num? finalPriceFrom;
  final bool hasSizes;
  final bool hasCustomisation;

  /// Sizes, or a group the client must choose in: never add it directly.
  final bool requiresChoice;

  /// When the dish was added (the "New" badge); `null` on old responses.
  final DateTime? createdAt;

  const Product({
    required this.id,
    required this.storeId,
    required this.categoryId,
    required this.name,
    this.description,
    required this.price,
    this.discountPercentage = 0,
    required this.finalPrice,
    this.unit = 'piece',
    this.unitStep = 1,
    this.stock,
    this.images = const [],
    this.isAvailable = true,
    this.store,
    this.category,
    this.variants = const [],
    this.optionGroups = const [],
    this.priceFrom,
    this.finalPriceFrom,
    this.hasSizes = false,
    this.hasCustomisation = false,
    this.requiresChoice = false,
    this.createdAt,
  });

  bool get hasDiscount => discountPercentage > 0;

  /// The product has sizes (from the flag on lists, the array on details).
  bool get isSized => hasSizes || variants.isNotEmpty;

  /// `false` only when the server says the store is closed (a closed
  /// store's menu is readable, not orderable).
  bool get storeIsOpen => store?.isOpen ?? true;

  /// Opens the customizer instead of a direct "+".
  bool get isCustomisable =>
      requiresChoice ||
      hasCustomisation ||
      variants.isNotEmpty ||
      optionGroups.isNotEmpty;

  /// Price to show on cards: "from X DA" when [isSized].
  num get displayPrice => isSized ? (finalPriceFrom ?? finalPrice) : finalPrice;
  num get displayOriginalPrice => isSized ? (priceFrom ?? price) : price;

  String? get mainImage => images.isEmpty ? null : images.first.url;

  /// Optimized variants of the first image (null for legacy uploads).
  MediaRef? get mainMedia => images.isEmpty ? null : images.first.media;

  factory Product.fromJson(Map<String, dynamic> json) =>
      _$ProductFromJson(json);

  Map<String, dynamic> toJson() => _$ProductToJson(this);

  static String _requiredId(dynamic value) => readId(value) ?? '';

  /// `/products` sends a ready `store` summary; `/home` only populates
  /// `storeId` (with a raw `{ar, en}` name), so build the summary from it.
  static Object? _readStore(Map<dynamic, dynamic> json, String key) {
    final store = json['store'];
    if (store is Map) return store;
    final populated = json['storeId'];
    if (populated is Map) {
      return {
        'id': populated['id'],
        'name': readLocalized(populated['name']),
        'logo': populated['logo'] ?? '',
        'isOpen': populated['isOpen'] ?? true,
      };
    }
    return null;
  }
}

@JsonSerializable(explicitToJson: true)
class ProductImage {
  final String url;
  @JsonKey(fromJson: MediaRef.maybeFromJson)
  final MediaRef? media;

  const ProductImage({required this.url, this.media});

  factory ProductImage.fromJson(Map<String, dynamic> json) =>
      _$ProductImageFromJson(json);

  Map<String, dynamic> toJson() => _$ProductImageToJson(this);
}

@JsonSerializable()
class ProductStore {
  final String id;
  final String name;
  final String logo;
  final bool isOpen;

  const ProductStore({
    required this.id,
    required this.name,
    this.logo = '',
    this.isOpen = true,
  });

  factory ProductStore.fromJson(Map<String, dynamic> json) =>
      _$ProductStoreFromJson(json);

  Map<String, dynamic> toJson() => _$ProductStoreToJson(this);
}

@JsonSerializable()
class ProductCategory {
  final String id;
  final String name;
  final String icon;

  const ProductCategory({required this.id, required this.name, this.icon = ''});

  factory ProductCategory.fromJson(Map<String, dynamic> json) =>
      _$ProductCategoryFromJson(json);

  Map<String, dynamic> toJson() => _$ProductCategoryToJson(this);
}

/// One size ("XL") with its own price. The id is stable across edits.
@JsonSerializable()
class ProductVariant {
  final String id;
  @JsonKey(fromJson: readLocalized)
  final String label;
  final num price;

  /// [price] after the product discount, computed by the server.
  final num? finalPrice;
  final bool isAvailable;

  const ProductVariant({
    required this.id,
    required this.label,
    required this.price,
    this.finalPrice,
    this.isAvailable = true,
  });

  factory ProductVariant.fromJson(Map<String, dynamic> json) =>
      _$ProductVariantFromJson(json);

  Map<String, dynamic> toJson() => _$ProductVariantToJson(this);
}

/// `supplement` = paid extra, `instruction` = free change ("Sans tomate").
@JsonSerializable(explicitToJson: true)
class ProductOptionGroup {
  final String id;

  /// `supplement | instruction`.
  final String kind;
  @JsonKey(fromJson: readLocalized)
  final String name;
  final int minSelect;

  /// `null` on odd payloads = every option may be ticked.
  final int? maxSelect;
  final List<ProductOption> options;

  const ProductOptionGroup({
    required this.id,
    this.kind = 'supplement',
    required this.name,
    this.minSelect = 0,
    this.maxSelect,
    this.options = const [],
  });

  bool get isInstruction => kind == 'instruction';

  int get effectiveMax => maxSelect ?? options.length;

  /// "Only one" / "must pick one": shown as radio buttons.
  bool get isSingleChoice => effectiveMax == 1;

  factory ProductOptionGroup.fromJson(Map<String, dynamic> json) =>
      _$ProductOptionGroupFromJson(json);

  Map<String, dynamic> toJson() => _$ProductOptionGroupToJson(this);
}

@JsonSerializable()
class ProductOption {
  final String id;
  @JsonKey(fromJson: readLocalized)
  final String label;

  /// Added to the unit price; always 0 for instructions.
  final num price;
  final bool isAvailable;

  const ProductOption({
    required this.id,
    required this.label,
    this.price = 0,
    this.isAvailable = true,
  });

  factory ProductOption.fromJson(Map<String, dynamic> json) =>
      _$ProductOptionFromJson(json);

  Map<String, dynamic> toJson() => _$ProductOptionToJson(this);
}
