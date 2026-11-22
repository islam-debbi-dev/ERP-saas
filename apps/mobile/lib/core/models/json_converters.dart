import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

/// Money and quantity fields: the API sends `Decimal` columns as strings
/// (`"1234.50"`, `"12.000"`). They become [Decimal], never `double`.
class DecimalConverter implements JsonConverter<Decimal, String> {
  const DecimalConverter();

  @override
  Decimal fromJson(String json) => Decimal.parse(json);

  @override
  String toJson(Decimal object) => object.toString();
}

class NullableDecimalConverter implements JsonConverter<Decimal?, String?> {
  const NullableDecimalConverter();

  @override
  Decimal? fromJson(String? json) => json == null ? null : Decimal.parse(json);

  @override
  String? toJson(Decimal? object) => object?.toString();
}

/// `{ id, fullName }` (`UserRef` in the shared schemas).
class UserRef {
  const UserRef({required this.id, required this.fullName});

  final String id;
  final String fullName;

  factory UserRef.fromJson(Map<String, dynamic> json) =>
      UserRef(id: json['id'] as String, fullName: json['fullName'] as String);
}

/// `{ id, name }` of a dépôt or a truck.
class NamedRef {
  const NamedRef({required this.id, required this.name});

  final String id;
  final String name;

  factory NamedRef.fromJson(Map<String, dynamic> json) =>
      NamedRef(id: json['id'] as String, name: json['name'] as String);
}

/// A truck (`VehicleRef`): a `Warehouse` of type VEHICLE.
class VehicleRef {
  const VehicleRef({required this.id, required this.name, this.code});

  final String id;
  final String? code;
  final String name;

  /// `code · name`, or the name alone when the truck has no code.
  String get label => code == null || code!.isEmpty ? name : '$code · $name';

  factory VehicleRef.fromJson(Map<String, dynamic> json) => VehicleRef(
    id: json['id'] as String,
    code: json['code'] as String?,
    name: json['name'] as String,
  );
}
