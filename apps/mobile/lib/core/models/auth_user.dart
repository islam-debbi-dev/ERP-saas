import 'package:json_annotation/json_annotation.dart';

import 'erp_codes.dart';

part 'auth_user.g.dart';

/// The signed-in user, as `GET /auth/me` returns it (`AuthUser` in
/// `packages/shared/src/schemas/auth.ts`).
@JsonSerializable()
class AuthUser {
  const AuthUser({
    required this.id,
    required this.fullName,
    required this.role,
    required this.tenantId,
    required this.tenantName,
    required this.edition,
    this.email,
    this.phone,
    this.permissions = const [],
    this.features = const [],
    this.warehouseIds,
    this.statsWarehouseIds,
    this.employeeId,
    this.mustChangePassword = false,
    this.impersonating = false,
  });

  final String id;
  final String? email;
  final String? phone;
  final String fullName;
  final String role;
  final String tenantId;
  final String tenantName;
  final List<String> permissions;
  final String edition;
  final List<String> features;

  /// Dépôts the user works in; null = all.
  final List<String>? warehouseIds;
  final List<String>? statsWarehouseIds;
  final String? employeeId;

  /// A temporary password: every other route answers PASSWORD_CHANGE_REQUIRED.
  final bool mustChangePassword;
  final bool impersonating;

  bool can(String permission) => permissions.contains(permission);
  bool hasFeature(String feature) => features.contains(feature);

  bool get isFieldRole => Role.fieldRoles.contains(role);

  factory AuthUser.fromJson(Map<String, dynamic> json) =>
      _$AuthUserFromJson(json);

  Map<String, dynamic> toJson() => _$AuthUserToJson(this);
}

/// `POST /auth/login` / `/auth/refresh` answer for a native client
/// (`AuthResponse`): the refresh token is in the body.
@JsonSerializable(createToJson: false)
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.user,
  });

  final String accessToken;
  final String refreshToken;

  /// Seconds until the access token expires.
  final int expiresIn;
  final AuthUser user;

  factory AuthSession.fromJson(Map<String, dynamic> json) =>
      _$AuthSessionFromJson(json);
}
