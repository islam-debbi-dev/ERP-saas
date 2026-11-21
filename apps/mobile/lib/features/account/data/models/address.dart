import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/geo_point.dart';

part 'address.g.dart';

/// A saved delivery address (`/me/addresses`). The backend keeps exactly one
/// default: the first address created, or whichever was last set default.
@JsonSerializable(explicitToJson: true, includeIfNull: false)
class Address {
  @JsonKey(includeToJson: false)
  final String id;
  final String label;
  final String fullAddress;
  final String? city;
  @JsonKey(fromJson: GeoPoint.maybeFromJson)
  final GeoPoint? location;
  final bool isDefault;

  const Address({
    this.id = '',
    this.label = 'Home',
    required this.fullAddress,
    this.city,
    this.location,
    this.isDefault = false,
  });

  factory Address.fromJson(Map<String, dynamic> json) =>
      _$AddressFromJson(json);

  /// Body for `POST /me/addresses` (and a full `PATCH`).
  Map<String, dynamic> toJson() => _$AddressToJson(this);
}
