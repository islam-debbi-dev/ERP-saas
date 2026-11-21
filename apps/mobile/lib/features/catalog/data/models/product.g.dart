// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'product.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Product _$ProductFromJson(Map<String, dynamic> json) => Product(
  id: json['id'] as String,
  storeId: Product._requiredId(json['storeId']),
  categoryId: Product._requiredId(json['categoryId']),
  name: json['name'] as String,
  description: json['description'] as String?,
  price: json['price'] as num,
  discountPercentage: json['discountPercentage'] as num? ?? 0,
  finalPrice: json['finalPrice'] as num,
  unit: json['unit'] as String? ?? 'piece',
  unitStep: json['unitStep'] as num? ?? 1,
  stock: json['stock'] as num?,
  images:
      (json['images'] as List<dynamic>?)
          ?.map((e) => ProductImage.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  isAvailable: json['isAvailable'] as bool? ?? true,
  store: Product._readStore(json, 'store') == null
      ? null
      : ProductStore.fromJson(
          Product._readStore(json, 'store') as Map<String, dynamic>,
        ),
  category: json['category'] == null
      ? null
      : ProductCategory.fromJson(json['category'] as Map<String, dynamic>),
  variants:
      (json['variants'] as List<dynamic>?)
          ?.map((e) => ProductVariant.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  optionGroups:
      (json['optionGroups'] as List<dynamic>?)
          ?.map((e) => ProductOptionGroup.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  priceFrom: json['priceFrom'] as num?,
  finalPriceFrom: json['finalPriceFrom'] as num?,
  hasSizes: json['hasSizes'] as bool? ?? false,
  hasCustomisation: json['hasCustomisation'] as bool? ?? false,
  requiresChoice: json['requiresChoice'] as bool? ?? false,
  createdAt: json['createdAt'] == null
      ? null
      : DateTime.parse(json['createdAt'] as String),
);

Map<String, dynamic> _$ProductToJson(Product instance) => <String, dynamic>{
  'id': instance.id,
  'storeId': instance.storeId,
  'categoryId': instance.categoryId,
  'name': instance.name,
  'description': instance.description,
  'price': instance.price,
  'discountPercentage': instance.discountPercentage,
  'finalPrice': instance.finalPrice,
  'unit': instance.unit,
  'unitStep': instance.unitStep,
  'stock': instance.stock,
  'images': instance.images.map((e) => e.toJson()).toList(),
  'isAvailable': instance.isAvailable,
  'store': instance.store?.toJson(),
  'category': instance.category?.toJson(),
  'variants': instance.variants.map((e) => e.toJson()).toList(),
  'optionGroups': instance.optionGroups.map((e) => e.toJson()).toList(),
  'priceFrom': instance.priceFrom,
  'finalPriceFrom': instance.finalPriceFrom,
  'hasSizes': instance.hasSizes,
  'hasCustomisation': instance.hasCustomisation,
  'requiresChoice': instance.requiresChoice,
  'createdAt': instance.createdAt?.toIso8601String(),
};

ProductImage _$ProductImageFromJson(Map<String, dynamic> json) => ProductImage(
  url: json['url'] as String,
  media: MediaRef.maybeFromJson(json['media']),
);

Map<String, dynamic> _$ProductImageToJson(ProductImage instance) =>
    <String, dynamic>{'url': instance.url, 'media': instance.media?.toJson()};

ProductStore _$ProductStoreFromJson(Map<String, dynamic> json) => ProductStore(
  id: json['id'] as String,
  name: json['name'] as String,
  logo: json['logo'] as String? ?? '',
  isOpen: json['isOpen'] as bool? ?? true,
);

Map<String, dynamic> _$ProductStoreToJson(ProductStore instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'logo': instance.logo,
      'isOpen': instance.isOpen,
    };

ProductCategory _$ProductCategoryFromJson(Map<String, dynamic> json) =>
    ProductCategory(
      id: json['id'] as String,
      name: json['name'] as String,
      icon: json['icon'] as String? ?? '',
    );

Map<String, dynamic> _$ProductCategoryToJson(ProductCategory instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'icon': instance.icon,
    };

ProductVariant _$ProductVariantFromJson(Map<String, dynamic> json) =>
    ProductVariant(
      id: json['id'] as String,
      label: readLocalized(json['label']),
      price: json['price'] as num,
      finalPrice: json['finalPrice'] as num?,
      isAvailable: json['isAvailable'] as bool? ?? true,
    );

Map<String, dynamic> _$ProductVariantToJson(ProductVariant instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'price': instance.price,
      'finalPrice': instance.finalPrice,
      'isAvailable': instance.isAvailable,
    };

ProductOptionGroup _$ProductOptionGroupFromJson(Map<String, dynamic> json) =>
    ProductOptionGroup(
      id: json['id'] as String,
      kind: json['kind'] as String? ?? 'supplement',
      name: readLocalized(json['name']),
      minSelect: (json['minSelect'] as num?)?.toInt() ?? 0,
      maxSelect: (json['maxSelect'] as num?)?.toInt(),
      options:
          (json['options'] as List<dynamic>?)
              ?.map((e) => ProductOption.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );

Map<String, dynamic> _$ProductOptionGroupToJson(ProductOptionGroup instance) =>
    <String, dynamic>{
      'id': instance.id,
      'kind': instance.kind,
      'name': instance.name,
      'minSelect': instance.minSelect,
      'maxSelect': instance.maxSelect,
      'options': instance.options.map((e) => e.toJson()).toList(),
    };

ProductOption _$ProductOptionFromJson(Map<String, dynamic> json) =>
    ProductOption(
      id: json['id'] as String,
      label: readLocalized(json['label']),
      price: json['price'] as num? ?? 0,
      isAvailable: json['isAvailable'] as bool? ?? true,
    );

Map<String, dynamic> _$ProductOptionToJson(ProductOption instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'price': instance.price,
      'isAvailable': instance.isAvailable,
    };
