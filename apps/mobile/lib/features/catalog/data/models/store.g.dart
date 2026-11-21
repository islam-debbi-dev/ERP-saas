// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'store.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Store _$StoreFromJson(Map<String, dynamic> json) => Store(
  id: json['id'] as String,
  name: json['name'] as String,
  slug: json['slug'] as String? ?? '',
  logo: json['logo'] as String? ?? '',
  cover: json['cover'] as String? ?? '',
  logoMedia: MediaRef.maybeFromJson(json['logoMedia']),
  coverMedia: MediaRef.maybeFromJson(json['coverMedia']),
  description: json['description'] as String?,
  phone: json['phone'] as String? ?? '',
  address: json['address'] as String? ?? '',
  location: GeoPoint.maybeFromJson(json['location']),
  categoryIds:
      (json['categoryIds'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ??
      const [],
  isOpen: json['isOpen'] as bool? ?? true,
  openingHours:
      (json['openingHours'] as List<dynamic>?)
          ?.map((e) => OpeningHour.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  minimumOrderAmount: json['minimumOrderAmount'] as num? ?? 0,
  products:
      (json['products'] as List<dynamic>?)
          ?.map((e) => Product.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  categories:
      (json['categories'] as List<dynamic>?)
          ?.map((e) => StoreMenuCategory.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$StoreToJson(Store instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'slug': instance.slug,
  'logo': instance.logo,
  'cover': instance.cover,
  'logoMedia': instance.logoMedia?.toJson(),
  'coverMedia': instance.coverMedia?.toJson(),
  'description': instance.description,
  'phone': instance.phone,
  'address': instance.address,
  'location': instance.location?.toJson(),
  'categoryIds': instance.categoryIds,
  'isOpen': instance.isOpen,
  'openingHours': instance.openingHours.map((e) => e.toJson()).toList(),
  'minimumOrderAmount': instance.minimumOrderAmount,
  'products': instance.products.map((e) => e.toJson()).toList(),
  'categories': instance.categories.map((e) => e.toJson()).toList(),
};

OpeningHour _$OpeningHourFromJson(Map<String, dynamic> json) => OpeningHour(
  day: (json['day'] as num).toInt(),
  open: json['open'] as String,
  close: json['close'] as String,
);

Map<String, dynamic> _$OpeningHourToJson(OpeningHour instance) =>
    <String, dynamic>{
      'day': instance.day,
      'open': instance.open,
      'close': instance.close,
    };

StoreMenuCategory _$StoreMenuCategoryFromJson(Map<String, dynamic> json) =>
    StoreMenuCategory(
      id: json['id'] as String,
      name: json['name'] as String,
      slug: json['slug'] as String? ?? '',
      icon: json['icon'] as String? ?? '',
      image: json['image'] as String? ?? '',
      imageMedia: MediaRef.maybeFromJson(json['imageMedia']),
      productCount: (json['productCount'] as num?)?.toInt() ?? 0,
    );

Map<String, dynamic> _$StoreMenuCategoryToJson(StoreMenuCategory instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'slug': instance.slug,
      'icon': instance.icon,
      'image': instance.image,
      'imageMedia': instance.imageMedia?.toJson(),
      'productCount': instance.productCount,
    };
