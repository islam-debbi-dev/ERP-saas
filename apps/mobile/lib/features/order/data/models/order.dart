import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/geo_point.dart';
import '../../../../core/models/json_readers.dart';

part 'order.g.dart';

/// Mirrors `ORDER_STATUSES` in `backend/src/models/Order.js`.
@JsonEnum(fieldRename: FieldRename.snake)
enum OrderStatus {
  pending,
  confirmed,
  outForDelivery,
  delivered,
  cancelled;

  /// Only a still-pending order can be cancelled by the client.
  bool get isCancelable => this == OrderStatus.pending;

  bool get isFinal =>
      this == OrderStatus.delivered || this == OrderStatus.cancelled;
}

/// `GET /orders/mine` (list rows: no [items] / [statusHistory]) and
/// `GET /orders/mine/:id`, `POST /orders`, `POST /orders/mine/:id/cancel`
/// (full detail). All amounts are integer DZD recomputed server-side.
@JsonSerializable(explicitToJson: true)
class Order {
  final String id;
  final String orderNumber;
  final OrderCustomer customer;
  final List<OrderItem> items;
  final num subtotal;

  /// `null` until the admin confirms the fee (by phone); [total] excludes it
  /// meanwhile.
  final num? deliveryFee;
  final bool deliveryFeeConfirmed;

  /// `'' | threshold | loyalty` (every-Nth-order reward).
  final String freeDeliveryReason;
  final num total;
  final num itemCount;

  /// Free-text request the admin prices later ([customRequestAmount]).
  final String customRequest;
  final num customRequestAmount;

  /// `none | pending | priced`.
  final String pricingStatus;
  final String paymentMethod;
  @JsonKey(unknownEnumValue: OrderStatus.pending)
  final OrderStatus status;
  final List<OrderStatusEvent> statusHistory;
  final String cancelReason;

  /// `admin | client | system`, empty unless cancelled.
  final String cancelledBy;
  @JsonKey(readValue: _readDeliveryPerson)
  final OrderDeliveryPerson? deliveryPerson;
  final DateTime? confirmedAt;
  final DateTime? outForDeliveryAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const Order({
    required this.id,
    required this.orderNumber,
    required this.customer,
    this.items = const [],
    required this.subtotal,
    this.deliveryFee,
    this.deliveryFeeConfirmed = true,
    this.freeDeliveryReason = '',
    required this.total,
    this.itemCount = 0,
    this.customRequest = '',
    this.customRequestAmount = 0,
    this.pricingStatus = 'none',
    this.paymentMethod = 'cod',
    required this.status,
    this.statusHistory = const [],
    this.cancelReason = '',
    this.cancelledBy = '',
    this.deliveryPerson,
    this.confirmedAt,
    this.outForDeliveryAt,
    this.deliveredAt,
    this.cancelledAt,
    required this.createdAt,
    this.updatedAt,
  });

  factory Order.fromJson(Map<String, dynamic> json) => _$OrderFromJson(json);

  Map<String, dynamic> toJson() => _$OrderToJson(this);

  /// Only the detail endpoint populates `deliveryPersonId`.
  static Object? _readDeliveryPerson(Map<dynamic, dynamic> json, String key) {
    final value = json['deliveryPersonId'];
    return value is Map ? value : null;
  }
}

@JsonSerializable(explicitToJson: true)
class OrderCustomer {
  final String name;
  final String phone;

  /// Empty when the client ordered without one (confirmed by phone).
  final String address;
  @JsonKey(fromJson: GeoPoint.maybeFromJson)
  final GeoPoint? location;
  final String note;

  const OrderCustomer({
    required this.name,
    required this.phone,
    this.address = '',
    this.location,
    this.note = '',
  });

  factory OrderCustomer.fromJson(Map<String, dynamic> json) =>
      _$OrderCustomerFromJson(json);

  Map<String, dynamic> toJson() => _$OrderCustomerToJson(this);
}

/// Price/name snapshot taken when the order was placed.
@JsonSerializable(explicitToJson: true)
class OrderItem {
  @JsonKey(fromJson: readId)
  final String? productId;
  @JsonKey(fromJson: _requiredId)
  final String storeId;

  /// Left as `{ar, en}` by the backend; resolved to the app language here.
  @JsonKey(fromJson: readLocalized)
  final String storeName;
  @JsonKey(fromJson: readLocalized)
  final String name;
  final String unit;
  final num unitPrice;
  final num qty;
  final num lineTotal;
  final String image;

  /// Chosen size, resolved to the app language.
  @JsonKey(fromJson: readLocalizedOrNull)
  final String? variantLabel;

  /// Ticked supplements and instructions (snapshot at order time).
  final List<OrderItemOption> options;

  const OrderItem({
    this.productId,
    required this.storeId,
    this.storeName = '',
    required this.name,
    this.unit = 'piece',
    required this.unitPrice,
    required this.qty,
    required this.lineTotal,
    this.image = '',
    this.variantLabel,
    this.options = const [],
  });

  List<OrderItemOption> get supplements =>
      options.where((o) => !o.isInstruction).toList();

  List<OrderItemOption> get instructions =>
      options.where((o) => o.isInstruction).toList();

  static String _requiredId(dynamic value) => readId(value) ?? '';

  factory OrderItem.fromJson(Map<String, dynamic> json) =>
      _$OrderItemFromJson(json);

  Map<String, dynamic> toJson() => _$OrderItemToJson(this);
}

/// A supplement or instruction frozen on an order line.
@JsonSerializable()
class OrderItemOption {
  /// `supplement | instruction`.
  final String kind;
  @JsonKey(fromJson: readLocalized)
  final String label;
  final num price;

  const OrderItemOption({
    this.kind = 'supplement',
    required this.label,
    this.price = 0,
  });

  bool get isInstruction => kind == 'instruction';

  factory OrderItemOption.fromJson(Map<String, dynamic> json) =>
      _$OrderItemOptionFromJson(json);

  Map<String, dynamic> toJson() => _$OrderItemOptionToJson(this);
}

@JsonSerializable()
class OrderStatusEvent {
  @JsonKey(unknownEnumValue: OrderStatus.pending)
  final OrderStatus status;
  final DateTime at;
  final String note;

  const OrderStatusEvent({
    required this.status,
    required this.at,
    this.note = '',
  });

  factory OrderStatusEvent.fromJson(Map<String, dynamic> json) =>
      _$OrderStatusEventFromJson(json);

  Map<String, dynamic> toJson() => _$OrderStatusEventToJson(this);
}

@JsonSerializable()
class OrderDeliveryPerson {
  final String id;
  final String fullName;
  final String phone;

  const OrderDeliveryPerson({
    required this.id,
    this.fullName = '',
    this.phone = '',
  });

  factory OrderDeliveryPerson.fromJson(Map<String, dynamic> json) =>
      _$OrderDeliveryPersonFromJson(json);

  Map<String, dynamic> toJson() => _$OrderDeliveryPersonToJson(this);
}
