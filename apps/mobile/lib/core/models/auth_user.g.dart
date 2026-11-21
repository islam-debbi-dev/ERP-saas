// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_user.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AuthUser _$AuthUserFromJson(Map<String, dynamic> json) => AuthUser(
  id: json['id'] as String,
  name: json['name'] as String,
  phone: json['phone'] as String,
  email: json['email'] as String?,
  avatar: json['avatar'] as String? ?? '',
  role: json['role'] as String? ?? 'client',
  storeId: json['storeId'] as String?,
  storeName: _readStoreName(json, 'storeName') as String?,
  preferredLanguage: json['preferredLanguage'] as String? ?? 'ar',
  isActive: json['isActive'] as bool? ?? true,
  isBlocked: json['isBlocked'] as bool? ?? false,
  mustChangePassword: json['mustChangePassword'] as bool? ?? false,
  addresses:
      (json['addresses'] as List<dynamic>?)
          ?.map((e) => Address.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  createdAt: json['createdAt'] == null
      ? null
      : DateTime.parse(json['createdAt'] as String),
);

Map<String, dynamic> _$AuthUserToJson(AuthUser instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'phone': instance.phone,
  'email': instance.email,
  'avatar': instance.avatar,
  'role': instance.role,
  'storeId': instance.storeId,
  'storeName': instance.storeName,
  'preferredLanguage': instance.preferredLanguage,
  'isActive': instance.isActive,
  'isBlocked': instance.isBlocked,
  'mustChangePassword': instance.mustChangePassword,
  'addresses': instance.addresses.map((e) => e.toJson()).toList(),
  'createdAt': instance.createdAt?.toIso8601String(),
};

AuthSession _$AuthSessionFromJson(Map<String, dynamic> json) => AuthSession(
  accessToken: json['accessToken'] as String,
  refreshToken: json['refreshToken'] as String,
  user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
);

Map<String, dynamic> _$AuthSessionToJson(AuthSession instance) =>
    <String, dynamic>{
      'accessToken': instance.accessToken,
      'refreshToken': instance.refreshToken,
      'user': instance.user.toJson(),
    };
