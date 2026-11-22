// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_user.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AuthUser _$AuthUserFromJson(Map<String, dynamic> json) => AuthUser(
  id: json['id'] as String,
  fullName: json['fullName'] as String,
  role: json['role'] as String,
  tenantId: json['tenantId'] as String,
  tenantName: json['tenantName'] as String,
  edition: json['edition'] as String,
  email: json['email'] as String?,
  phone: json['phone'] as String?,
  permissions:
      (json['permissions'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ??
      const [],
  features:
      (json['features'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      const [],
  warehouseIds: (json['warehouseIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  statsWarehouseIds: (json['statsWarehouseIds'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  employeeId: json['employeeId'] as String?,
  mustChangePassword: json['mustChangePassword'] as bool? ?? false,
  impersonating: json['impersonating'] as bool? ?? false,
);

Map<String, dynamic> _$AuthUserToJson(AuthUser instance) => <String, dynamic>{
  'id': instance.id,
  'email': instance.email,
  'phone': instance.phone,
  'fullName': instance.fullName,
  'role': instance.role,
  'tenantId': instance.tenantId,
  'tenantName': instance.tenantName,
  'permissions': instance.permissions,
  'edition': instance.edition,
  'features': instance.features,
  'warehouseIds': instance.warehouseIds,
  'statsWarehouseIds': instance.statsWarehouseIds,
  'employeeId': instance.employeeId,
  'mustChangePassword': instance.mustChangePassword,
  'impersonating': instance.impersonating,
};

AuthSession _$AuthSessionFromJson(Map<String, dynamic> json) => AuthSession(
  accessToken: json['accessToken'] as String,
  refreshToken: json['refreshToken'] as String,
  expiresIn: (json['expiresIn'] as num).toInt(),
  user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
);
