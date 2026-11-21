// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AppConfig _$AppConfigFromJson(Map<String, dynamic> json) => AppConfig(
  orderingEnabled: json['orderingEnabled'] as bool,
  closedMessage: json['closedMessage'] as String? ?? '',
  deliveryFee: json['deliveryFee'] as num? ?? 0,
  minOrderAmount: json['minOrderAmount'] as num? ?? 0,
  supportPhone: json['supportPhone'] as String? ?? '',
  defaultLanguage: json['defaultLanguage'] as String? ?? 'ar',
  timezone: json['timezone'] as String? ?? '',
  currency: json['currency'] as String? ?? 'DZD',
  shopName: json['shopName'] as String? ?? '',
  app: json['app'] == null
      ? const AppVersionInfo()
      : AppVersionInfo.fromJson(json['app'] as Map<String, dynamic>),
);

Map<String, dynamic> _$AppConfigToJson(AppConfig instance) => <String, dynamic>{
  'orderingEnabled': instance.orderingEnabled,
  'closedMessage': instance.closedMessage,
  'deliveryFee': instance.deliveryFee,
  'minOrderAmount': instance.minOrderAmount,
  'supportPhone': instance.supportPhone,
  'defaultLanguage': instance.defaultLanguage,
  'timezone': instance.timezone,
  'currency': instance.currency,
  'shopName': instance.shopName,
  'app': instance.app.toJson(),
};

AppVersionInfo _$AppVersionInfoFromJson(Map<String, dynamic> json) =>
    AppVersionInfo(
      minVersion: json['minVersion'] as String? ?? '1.0.0',
      latestVersion: json['latestVersion'] as String? ?? '1.0.0',
      forceUpdate: json['forceUpdate'] as bool? ?? false,
      maintenanceMessage: json['maintenanceMessage'] as String? ?? '',
    );

Map<String, dynamic> _$AppVersionInfoToJson(AppVersionInfo instance) =>
    <String, dynamic>{
      'minVersion': instance.minVersion,
      'latestVersion': instance.latestVersion,
      'forceUpdate': instance.forceUpdate,
      'maintenanceMessage': instance.maintenanceMessage,
    };
