import 'package:json_annotation/json_annotation.dart';

import '../../features/account/data/models/address.dart';
import 'json_readers.dart';

part 'auth_user.g.dart';

/// The signed-in user, as returned by `/auth/login`, `/auth/register`,
/// `/auth/me` and `GET/PATCH /me` (all share the backend `publicUser` shape).
@JsonSerializable(explicitToJson: true)
class AuthUser {
  final String id;
  final String name;
  final String phone;
  final String? email;
  final String avatar;

  /// `client | store_manager | admin` — the app signs in clients and store
  /// managers (who order like any customer); admins are refused.
  final String role;

  /// The store a manager runs (`null` for clients).
  final String? storeId;

  /// Name of that store, from `GET /me` (`store.name`, resolved to the API
  /// language). Missing on `/auth/*` responses until `/me` is fetched.
  @JsonKey(readValue: _readStoreName)
  final String? storeName;

  /// `ar | en`.
  final String preferredLanguage;
  final bool isActive;
  final bool isBlocked;
  final bool mustChangePassword;
  final List<Address> addresses;
  final DateTime? createdAt;

  const AuthUser({
    required this.id,
    required this.name,
    required this.phone,
    this.email,
    this.avatar = '',
    this.role = 'client',
    this.storeId,
    this.storeName,
    this.preferredLanguage = 'ar',
    this.isActive = true,
    this.isBlocked = false,
    this.mustChangePassword = false,
    this.addresses = const [],
    this.createdAt,
  });

  bool get isStoreManager => role == 'store_manager';

  Address? get defaultAddress {
    for (final address in addresses) {
      if (address.isDefault) return address;
    }
    return addresses.isEmpty ? null : addresses.first;
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) =>
      _$AuthUserFromJson(json);

  Map<String, dynamic> toJson() => _$AuthUserToJson(this);
}

/// `GET /me` sends `store: { id, name: { ar, en } }`; a cached `toJson` copy
/// sends `storeName` directly.
Object? _readStoreName(Map<dynamic, dynamic> json, String key) {
  final store = json['store'];
  if (store is Map) {
    final name = readLocalized(store['name']);
    return name.isEmpty ? null : name;
  }
  return json[key];
}

/// `{ accessToken, refreshToken, user }` from login / register / refresh.
@JsonSerializable(explicitToJson: true)
class AuthSession {
  final String accessToken;
  final String refreshToken;
  final AuthUser user;

  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) =>
      _$AuthSessionFromJson(json);

  Map<String, dynamic> toJson() => _$AuthSessionToJson(this);
}
