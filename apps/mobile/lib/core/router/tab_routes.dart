import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/ui/account_screen.dart';
import '../../features/clients/ui/client_detail_screen.dart';
import '../../features/clients/ui/client_statement_screen.dart';
import '../../features/clients/ui/clients_screen.dart';
import '../../features/clients/ui/new_client_screen.dart';
import '../../features/main_screen/ui/placeholder_tab.dart';
import '../../features/today/ui/today_screen.dart';
import 'role_screens.dart';

/// The root navigator: forms pushed on it cover the bottom bar, so their
/// main action sits in a bottom bar of their own (docs/ui.md).
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// The page of a tab. Tabs of a later sub-phase stay placeholders; "Plus"
/// is the account screen until its menu exists.
Widget tabPage(RoleTab tab) {
  final p = tab.path;
  if (p == '/seller/today') {
    return Builder(
      builder: (context) => TodayScreen(
        onOpenClient: (context, stop) =>
            context.push('/seller/clients/${stop.client.id}'),
        onOpenClients: () => context.go('/seller/clients'),
      ),
    );
  }
  if (p == '/seller/clients') return ClientsScreen(basePath: p);
  if (p.endsWith('/more')) return const AccountScreen();
  return PlaceholderTab(tab: tab);
}

/// Screens under a tab (`<tab>/:id`...). Their paths start with the tab's,
/// so `RoleScreens.allows` keeps them to the tab's role.
List<RouteBase> tabSubRoutes(RoleTab tab) {
  if (tab.path == '/seller/clients') return clientRoutes(tab.path);
  return const [];
}

/// Client list → new client, client detail, statement.
List<RouteBase> clientRoutes(String base) => [
  GoRoute(
    path: 'new',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, _) => const NewClientScreen(),
  ),
  GoRoute(
    path: ':clientId',
    builder: (_, state) {
      final id = state.pathParameters['clientId']!;
      return ClientDetailScreen(clientId: id, basePath: '$base/$id');
    },
    routes: [
      GoRoute(
        path: 'statement',
        builder: (_, state) =>
            ClientStatementScreen(clientId: state.pathParameters['clientId']!),
      ),
    ],
  ),
];
