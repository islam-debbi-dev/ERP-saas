import 'package:flutter/material.dart';

import '../models/auth_user.dart';
import '../models/erp_codes.dart';
import 'routes.dart';

/// One bottom tab of a role's shell.
class RoleTab {
  const RoleTab({
    required this.path,
    required this.labelKey,
    required this.icon,
    this.permission,
    this.feature,
  });

  /// Root path of the tab; its sub-screens live under it.
  final String path;
  final String labelKey;
  final IconData icon;

  /// Shown only when the user has this permission (role default or grant).
  final String? permission;

  /// Shown only when the tenant's edition has this module.
  final String? feature;

  bool visibleFor(AuthUser user) =>
      (permission == null || user.can(permission!)) &&
      (feature == null || user.hasFeature(feature!));
}

/// The single table of which screens each field role gets (phase 39). The
/// router builds one shell per role from it, the bottom bar shows the visible
/// tabs, and the redirect refuses any path outside them. The API enforces the
/// same rights: hiding is only for clarity.
class RoleScreens {
  RoleScreens._();

  static const tabs = <String, List<RoleTab>>{
    Role.seller: [
      RoleTab(
        path: '/seller/today',
        labelKey: 'tabs.today',
        icon: Icons.today_outlined,
      ),
      RoleTab(
        path: '/seller/clients',
        labelKey: 'tabs.clients',
        icon: Icons.people_alt_outlined,
      ),
      RoleTab(
        path: '/seller/sell',
        labelKey: 'tabs.sell',
        icon: Icons.point_of_sale_outlined,
        permission: Permission.salesCreate,
      ),
      RoleTab(
        path: '/seller/truck',
        labelKey: 'tabs.my_truck',
        icon: Icons.local_shipping_outlined,
      ),
      RoleTab(
        path: '/seller/more',
        labelKey: 'tabs.more',
        icon: Icons.more_horiz,
      ),
    ],
    Role.livreur: [
      RoleTab(
        path: '/livreur/deliveries',
        labelKey: 'tabs.deliveries',
        icon: Icons.inventory_2_outlined,
      ),
      RoleTab(
        path: '/livreur/clients',
        labelKey: 'tabs.clients',
        icon: Icons.people_alt_outlined,
      ),
      RoleTab(
        path: '/livreur/truck',
        labelKey: 'tabs.my_truck',
        icon: Icons.local_shipping_outlined,
      ),
      RoleTab(
        path: '/livreur/more',
        labelKey: 'tabs.more',
        icon: Icons.more_horiz,
      ),
    ],
    Role.supervisor: [
      RoleTab(
        path: '/supervisor/team',
        labelKey: 'tabs.team',
        icon: Icons.groups_outlined,
      ),
      RoleTab(
        path: '/supervisor/orders',
        labelKey: 'tabs.orders',
        icon: Icons.receipt_long_outlined,
      ),
      RoleTab(
        path: '/supervisor/controls',
        labelKey: 'tabs.controls',
        icon: Icons.verified_user_outlined,
      ),
      RoleTab(
        path: '/supervisor/more',
        labelKey: 'tabs.more',
        icon: Icons.more_horiz,
      ),
    ],
    Role.storekeeper: [
      RoleTab(
        path: '/storekeeper/loads',
        labelKey: 'tabs.loads',
        icon: Icons.move_to_inbox_outlined,
        feature: Feature.warehouses,
      ),
      RoleTab(
        path: '/storekeeper/trucks',
        labelKey: 'tabs.trucks',
        icon: Icons.local_shipping_outlined,
        feature: Feature.warehouses,
      ),
      RoleTab(
        path: '/storekeeper/inventory',
        labelKey: 'tabs.inventory',
        icon: Icons.fact_check_outlined,
        permission: Permission.stockCount,
      ),
      RoleTab(
        path: '/storekeeper/more',
        labelKey: 'tabs.more',
        icon: Icons.more_horiz,
      ),
    ],
  };

  /// Screens every signed-in field user may open (pushed over the shell).
  static const commonPaths = [
    Routes.changePassword,
    Routes.helpCenter,
    Routes.privacyPolicy,
  ];

  /// All tabs of the user's role, visible or not (the shell's branches).
  static List<RoleTab> allTabsFor(String role) => tabs[role] ?? const [];

  /// The tabs the user sees, in bottom-bar order.
  static List<RoleTab> visibleTabsFor(AuthUser user) => allTabsFor(
    user.role,
  ).where((t) => t.visibleFor(user)).toList(growable: false);

  /// Where the user lands: his role's first visible tab. The last tab (Plus)
  /// has no condition, so a field role always has a home.
  static String homeFor(AuthUser user) {
    final visible = visibleTabsFor(user);
    return visible.isEmpty ? Routes.login : visible.first.path;
  }

  /// Whether [path] is one of the user's own screens. A path of another role,
  /// or of a tab hidden for him, is refused.
  static bool allows(AuthUser user, String path) {
    if (commonPaths.contains(path)) return true;
    return visibleTabsFor(
      user,
    ).any((t) => path == t.path || path.startsWith('${t.path}/'));
  }
}
