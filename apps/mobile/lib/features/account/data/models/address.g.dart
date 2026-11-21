// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'address.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Address _$AddressFromJson(Map<String, dynamic> json) => Address(
  id: json['id'] as String? ?? '',
  label: json['label'] as String? ?? 'Home',
  fullAddress: json['fullAddress'] as String,
  city: json['city'] as String?,
  location: GeoPoint.maybeFromJson(json['location']),
  isDefault: json['isDefault'] as bool? ?? false,
);

Map<String, dynamic> _$AddressToJson(Address instance) => <String, dynamic>{
  'label': instance.label,
  'fullAddress': instance.fullAddress,
  'city': ?instance.city,
  'location': ?instance.location?.toJson(),
  'isDefault': instance.isDefault,
};
