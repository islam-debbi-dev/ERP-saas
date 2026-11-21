// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_order_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateOrderRequest _$CreateOrderRequestFromJson(Map<String, dynamic> json) =>
    CreateOrderRequest(
      items:
          (json['items'] as List<dynamic>?)
              ?.map((e) => CreateOrderItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      customRequest: json['customRequest'] as String?,
      customer: CreateOrderCustomer.fromJson(
        json['customer'] as Map<String, dynamic>,
      ),
      addressId: json['addressId'] as String?,
    );

Map<String, dynamic> _$CreateOrderRequestToJson(CreateOrderRequest instance) =>
    <String, dynamic>{
      'items': instance.items.map((e) => e.toJson()).toList(),
      'customRequest': ?instance.customRequest,
      'customer': instance.customer.toJson(),
      'addressId': ?instance.addressId,
    };

CreateOrderItem _$CreateOrderItemFromJson(Map<String, dynamic> json) =>
    CreateOrderItem(
      productId: json['productId'] as String,
      qty: json['qty'] as num,
      variantId: json['variantId'] as String?,
      optionIds: (json['optionIds'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$CreateOrderItemToJson(CreateOrderItem instance) =>
    <String, dynamic>{
      'productId': instance.productId,
      'qty': instance.qty,
      'variantId': ?instance.variantId,
      'optionIds': ?instance.optionIds,
    };

CreateOrderCustomer _$CreateOrderCustomerFromJson(Map<String, dynamic> json) =>
    CreateOrderCustomer(
      name: json['name'] as String?,
      phone: json['phone'] as String,
      address: json['address'] as String?,
      location: json['location'] == null
          ? null
          : GeoPoint.fromJson(json['location'] as Map<String, dynamic>),
      note: json['note'] as String?,
    );

Map<String, dynamic> _$CreateOrderCustomerToJson(
  CreateOrderCustomer instance,
) => <String, dynamic>{
  'name': ?instance.name,
  'phone': instance.phone,
  'address': ?instance.address,
  'location': ?instance.location?.toJson(),
  'note': ?instance.note,
};
