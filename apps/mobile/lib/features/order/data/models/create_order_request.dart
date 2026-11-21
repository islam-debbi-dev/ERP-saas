import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/geo_point.dart';

part 'create_order_request.g.dart';

/// Body of `POST /orders` (cash on delivery only).
///
/// The backend recomputes every price from the database, so items carry only
/// `productId` + `qty`, plus the chosen size / option ids (never prices). Either [items] or [customRequest] must be non-empty.
/// With [addressId] the server snapshots that saved address and ignores
/// `customer.address` / `customer.location`; `customer.phone` is always
/// required.
@JsonSerializable(explicitToJson: true, includeIfNull: false)
class CreateOrderRequest {
  final List<CreateOrderItem> items;
  final String? customRequest;
  final CreateOrderCustomer customer;
  final String? addressId;

  const CreateOrderRequest({
    this.items = const [],
    this.customRequest,
    required this.customer,
    this.addressId,
  });

  factory CreateOrderRequest.fromJson(Map<String, dynamic> json) =>
      _$CreateOrderRequestFromJson(json);

  Map<String, dynamic> toJson() => _$CreateOrderRequestToJson(this);
}

@JsonSerializable(includeIfNull: false)
class CreateOrderItem {
  final String productId;

  /// Must be a multiple of the product's `unitStep`.
  final num qty;

  /// Chosen size, required by the server when the product has sizes.
  final String? variantId;

  /// Ticked supplements / instructions.
  final List<String>? optionIds;

  const CreateOrderItem({
    required this.productId,
    required this.qty,
    this.variantId,
    this.optionIds,
  });

  factory CreateOrderItem.fromJson(Map<String, dynamic> json) =>
      _$CreateOrderItemFromJson(json);

  Map<String, dynamic> toJson() => _$CreateOrderItemToJson(this);
}

@JsonSerializable(explicitToJson: true, includeIfNull: false)
class CreateOrderCustomer {
  final String? name;
  final String phone;
  final String? address;
  final GeoPoint? location;
  final String? note;

  const CreateOrderCustomer({
    this.name,
    required this.phone,
    this.address,
    this.location,
    this.note,
  });

  factory CreateOrderCustomer.fromJson(Map<String, dynamic> json) =>
      _$CreateOrderCustomerFromJson(json);

  Map<String, dynamic> toJson() => _$CreateOrderCustomerToJson(this);
}
