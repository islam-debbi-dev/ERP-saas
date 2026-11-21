import 'package:json_annotation/json_annotation.dart';

part 'app_config.g.dart';

/// `GET /app/config` — startup settings.
@JsonSerializable(explicitToJson: true)
class AppConfig {
  final bool orderingEnabled;
  final String closedMessage;
  final num deliveryFee;
  final num minOrderAmount;
  final String supportPhone;
  final String defaultLanguage;
  final String timezone;
  final String currency;
  final String shopName;
  final AppVersionInfo app;

  const AppConfig({
    required this.orderingEnabled,
    this.closedMessage = '',
    this.deliveryFee = 0,
    this.minOrderAmount = 0,
    this.supportPhone = '',
    this.defaultLanguage = 'ar',
    this.timezone = '',
    this.currency = 'DZD',
    this.shopName = '',
    this.app = const AppVersionInfo(),
  });

  factory AppConfig.fromJson(Map<String, dynamic> json) =>
      _$AppConfigFromJson(json);

  Map<String, dynamic> toJson() => _$AppConfigToJson(this);
}

@JsonSerializable()
class AppVersionInfo {
  final String minVersion;
  final String latestVersion;
  final bool forceUpdate;
  final String maintenanceMessage;

  const AppVersionInfo({
    this.minVersion = '1.0.0',
    this.latestVersion = '1.0.0',
    this.forceUpdate = false,
    this.maintenanceMessage = '',
  });

  factory AppVersionInfo.fromJson(Map<String, dynamic> json) =>
      _$AppVersionInfoFromJson(json);

  Map<String, dynamic> toJson() => _$AppVersionInfoToJson(this);
}
