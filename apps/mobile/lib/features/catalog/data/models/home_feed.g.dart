// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'home_feed.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

HomeFeed _$HomeFeedFromJson(Map<String, dynamic> json) => HomeFeed(
  shopName: json['shopName'] as String? ?? '',
  orderingEnabled: json['orderingEnabled'] as bool,
  deliveryFee: json['deliveryFee'] as num? ?? 0,
  freeDeliveryEveryOrders: json['freeDeliveryEveryOrders'] as num? ?? 0,
  loyalty: json['loyalty'] == null
      ? null
      : LoyaltyStatus.fromJson(json['loyalty'] as Map<String, dynamic>),
  supportPhone: json['supportPhone'] as String? ?? '',
  supportPhone2: json['supportPhone2'] as String? ?? '',
  categories:
      (json['categories'] as List<dynamic>?)
          ?.map((e) => Category.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  featuredProducts:
      (json['featuredProducts'] as List<dynamic>?)
          ?.map((e) => Product.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  featuredKind: json['featuredKind'] as String?,
  featuredScope: json['featuredScope'] as String?,
  stores:
      (json['stores'] as List<dynamic>?)
          ?.map((e) => Store.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$HomeFeedToJson(HomeFeed instance) => <String, dynamic>{
  'shopName': instance.shopName,
  'orderingEnabled': instance.orderingEnabled,
  'deliveryFee': instance.deliveryFee,
  'freeDeliveryEveryOrders': instance.freeDeliveryEveryOrders,
  'loyalty': instance.loyalty?.toJson(),
  'supportPhone': instance.supportPhone,
  'supportPhone2': instance.supportPhone2,
  'categories': instance.categories.map((e) => e.toJson()).toList(),
  'featuredProducts': instance.featuredProducts.map((e) => e.toJson()).toList(),
  'featuredKind': instance.featuredKind,
  'featuredScope': instance.featuredScope,
  'stores': instance.stores.map((e) => e.toJson()).toList(),
};

LoyaltyStatus _$LoyaltyStatusFromJson(Map<String, dynamic> json) =>
    LoyaltyStatus(
      everyOrders: (json['everyOrders'] as num).toInt(),
      ordersSinceFree: (json['ordersSinceFree'] as num?)?.toInt() ?? 0,
      ordersUntilFree: (json['ordersUntilFree'] as num?)?.toInt() ?? 0,
      nextOrderFree: json['nextOrderFree'] as bool? ?? false,
    );

Map<String, dynamic> _$LoyaltyStatusToJson(LoyaltyStatus instance) =>
    <String, dynamic>{
      'everyOrders': instance.everyOrders,
      'ordersSinceFree': instance.ordersSinceFree,
      'ordersUntilFree': instance.ordersUntilFree,
      'nextOrderFree': instance.nextOrderFree,
    };
