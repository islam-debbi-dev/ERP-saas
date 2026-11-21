// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cart_line.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CartLine _$CartLineFromJson(Map<String, dynamic> json) => CartLine(
  productId: json['productId'] as String,
  name: json['name'] as String,
  image: json['image'] as String? ?? '',
  unitPrice: json['unitPrice'] as num,
  unit: json['unit'] as String? ?? 'piece',
  unitStep: json['unitStep'] as num? ?? 1,
  storeId: json['storeId'] as String? ?? '',
  storeName: json['storeName'] as String? ?? '',
  qty: json['qty'] as num,
  variantId: json['variantId'] as String?,
  variantLabel: json['variantLabel'] as String?,
  options:
      (json['options'] as List<dynamic>?)
          ?.map((e) => CartOption.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$CartLineToJson(CartLine instance) => <String, dynamic>{
  'productId': instance.productId,
  'name': instance.name,
  'image': instance.image,
  'unitPrice': instance.unitPrice,
  'unit': instance.unit,
  'unitStep': instance.unitStep,
  'storeId': instance.storeId,
  'storeName': instance.storeName,
  'qty': instance.qty,
  'variantId': instance.variantId,
  'variantLabel': instance.variantLabel,
  'options': instance.options.map((e) => e.toJson()).toList(),
};

CartOption _$CartOptionFromJson(Map<String, dynamic> json) => CartOption(
  id: json['id'] as String,
  kind: json['kind'] as String? ?? 'supplement',
  label: json['label'] as String,
  price: json['price'] as num? ?? 0,
);

Map<String, dynamic> _$CartOptionToJson(CartOption instance) =>
    <String, dynamic>{
      'id': instance.id,
      'kind': instance.kind,
      'label': instance.label,
      'price': instance.price,
    };
