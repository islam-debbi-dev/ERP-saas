// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'order.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Order _$OrderFromJson(Map<String, dynamic> json) => Order(
  id: json['id'] as String,
  orderNumber: json['orderNumber'] as String,
  customer: OrderCustomer.fromJson(json['customer'] as Map<String, dynamic>),
  items:
      (json['items'] as List<dynamic>?)
          ?.map((e) => OrderItem.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  subtotal: json['subtotal'] as num,
  deliveryFee: json['deliveryFee'] as num?,
  deliveryFeeConfirmed: json['deliveryFeeConfirmed'] as bool? ?? true,
  freeDeliveryReason: json['freeDeliveryReason'] as String? ?? '',
  total: json['total'] as num,
  itemCount: json['itemCount'] as num? ?? 0,
  customRequest: json['customRequest'] as String? ?? '',
  customRequestAmount: json['customRequestAmount'] as num? ?? 0,
  pricingStatus: json['pricingStatus'] as String? ?? 'none',
  paymentMethod: json['paymentMethod'] as String? ?? 'cod',
  status: $enumDecode(
    _$OrderStatusEnumMap,
    json['status'],
    unknownValue: OrderStatus.pending,
  ),
  statusHistory:
      (json['statusHistory'] as List<dynamic>?)
          ?.map((e) => OrderStatusEvent.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  cancelReason: json['cancelReason'] as String? ?? '',
  cancelledBy: json['cancelledBy'] as String? ?? '',
  deliveryPerson: Order._readDeliveryPerson(json, 'deliveryPerson') == null
      ? null
      : OrderDeliveryPerson.fromJson(
          Order._readDeliveryPerson(json, 'deliveryPerson')
              as Map<String, dynamic>,
        ),
  confirmedAt: json['confirmedAt'] == null
      ? null
      : DateTime.parse(json['confirmedAt'] as String),
  outForDeliveryAt: json['outForDeliveryAt'] == null
      ? null
      : DateTime.parse(json['outForDeliveryAt'] as String),
  deliveredAt: json['deliveredAt'] == null
      ? null
      : DateTime.parse(json['deliveredAt'] as String),
  cancelledAt: json['cancelledAt'] == null
      ? null
      : DateTime.parse(json['cancelledAt'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  updatedAt: json['updatedAt'] == null
      ? null
      : DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$OrderToJson(Order instance) => <String, dynamic>{
  'id': instance.id,
  'orderNumber': instance.orderNumber,
  'customer': instance.customer.toJson(),
  'items': instance.items.map((e) => e.toJson()).toList(),
  'subtotal': instance.subtotal,
  'deliveryFee': instance.deliveryFee,
  'deliveryFeeConfirmed': instance.deliveryFeeConfirmed,
  'freeDeliveryReason': instance.freeDeliveryReason,
  'total': instance.total,
  'itemCount': instance.itemCount,
  'customRequest': instance.customRequest,
  'customRequestAmount': instance.customRequestAmount,
  'pricingStatus': instance.pricingStatus,
  'paymentMethod': instance.paymentMethod,
  'status': _$OrderStatusEnumMap[instance.status]!,
  'statusHistory': instance.statusHistory.map((e) => e.toJson()).toList(),
  'cancelReason': instance.cancelReason,
  'cancelledBy': instance.cancelledBy,
  'deliveryPerson': instance.deliveryPerson?.toJson(),
  'confirmedAt': instance.confirmedAt?.toIso8601String(),
  'outForDeliveryAt': instance.outForDeliveryAt?.toIso8601String(),
  'deliveredAt': instance.deliveredAt?.toIso8601String(),
  'cancelledAt': instance.cancelledAt?.toIso8601String(),
  'createdAt': instance.createdAt.toIso8601String(),
  'updatedAt': instance.updatedAt?.toIso8601String(),
};

const _$OrderStatusEnumMap = {
  OrderStatus.pending: 'pending',
  OrderStatus.confirmed: 'confirmed',
  OrderStatus.outForDelivery: 'out_for_delivery',
  OrderStatus.delivered: 'delivered',
  OrderStatus.cancelled: 'cancelled',
};

OrderCustomer _$OrderCustomerFromJson(Map<String, dynamic> json) =>
    OrderCustomer(
      name: json['name'] as String,
      phone: json['phone'] as String,
      address: json['address'] as String? ?? '',
      location: GeoPoint.maybeFromJson(json['location']),
      note: json['note'] as String? ?? '',
    );

Map<String, dynamic> _$OrderCustomerToJson(OrderCustomer instance) =>
    <String, dynamic>{
      'name': instance.name,
      'phone': instance.phone,
      'address': instance.address,
      'location': instance.location?.toJson(),
      'note': instance.note,
    };

OrderItem _$OrderItemFromJson(Map<String, dynamic> json) => OrderItem(
  productId: readId(json['productId']),
  storeId: OrderItem._requiredId(json['storeId']),
  storeName: json['storeName'] == null ? '' : readLocalized(json['storeName']),
  name: readLocalized(json['name']),
  unit: json['unit'] as String? ?? 'piece',
  unitPrice: json['unitPrice'] as num,
  qty: json['qty'] as num,
  lineTotal: json['lineTotal'] as num,
  image: json['image'] as String? ?? '',
  variantLabel: readLocalizedOrNull(json['variantLabel']),
  options:
      (json['options'] as List<dynamic>?)
          ?.map((e) => OrderItemOption.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$OrderItemToJson(OrderItem instance) => <String, dynamic>{
  'productId': instance.productId,
  'storeId': instance.storeId,
  'storeName': instance.storeName,
  'name': instance.name,
  'unit': instance.unit,
  'unitPrice': instance.unitPrice,
  'qty': instance.qty,
  'lineTotal': instance.lineTotal,
  'image': instance.image,
  'variantLabel': instance.variantLabel,
  'options': instance.options.map((e) => e.toJson()).toList(),
};

OrderItemOption _$OrderItemOptionFromJson(Map<String, dynamic> json) =>
    OrderItemOption(
      kind: json['kind'] as String? ?? 'supplement',
      label: readLocalized(json['label']),
      price: json['price'] as num? ?? 0,
    );

Map<String, dynamic> _$OrderItemOptionToJson(OrderItemOption instance) =>
    <String, dynamic>{
      'kind': instance.kind,
      'label': instance.label,
      'price': instance.price,
    };

OrderStatusEvent _$OrderStatusEventFromJson(Map<String, dynamic> json) =>
    OrderStatusEvent(
      status: $enumDecode(
        _$OrderStatusEnumMap,
        json['status'],
        unknownValue: OrderStatus.pending,
      ),
      at: DateTime.parse(json['at'] as String),
      note: json['note'] as String? ?? '',
    );

Map<String, dynamic> _$OrderStatusEventToJson(OrderStatusEvent instance) =>
    <String, dynamic>{
      'status': _$OrderStatusEnumMap[instance.status]!,
      'at': instance.at.toIso8601String(),
      'note': instance.note,
    };

OrderDeliveryPerson _$OrderDeliveryPersonFromJson(Map<String, dynamic> json) =>
    OrderDeliveryPerson(
      id: json['id'] as String,
      fullName: json['fullName'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
    );

Map<String, dynamic> _$OrderDeliveryPersonToJson(
  OrderDeliveryPerson instance,
) => <String, dynamic>{
  'id': instance.id,
  'fullName': instance.fullName,
  'phone': instance.phone,
};
