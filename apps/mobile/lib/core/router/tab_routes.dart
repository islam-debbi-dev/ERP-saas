import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/ui/account_screen.dart';
import '../../features/clients/ui/client_detail_screen.dart';
import '../../features/clients/ui/client_statement_screen.dart';
import '../../features/clients/ui/clients_screen.dart';
import '../../features/clients/ui/new_client_screen.dart';
import '../../features/main_screen/ui/placeholder_tab.dart';
import '../../features/orders/ui/my_orders_screen.dart';
import '../models/erp_codes.dart';
import '../session/session_cubit.dart';
import '../../features/sales/logic/basket.dart';
import '../../features/sales/ui/sale_screen.dart';
import '../../features/sales/ui/sell_screen.dart';
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
  if (p == '/seller/sell') return SellScreen(basePath: p);
  if (p == '/seller/more') {
    return Builder(
      builder: (context) => AccountScreen(menu: sellerMenu(context)),
    );
  }
  if (p.endsWith('/more')) return const AccountScreen();
  return PlaceholderTab(tab: tab);
}

/// Screens under a tab (`<tab>/:id`...). Their paths start with the tab's,
/// so `RoleScreens.allows` keeps them to the tab's role.
List<RouteBase> tabSubRoutes(RoleTab tab) {
  if (tab.path == '/seller/clients') return clientRoutes(tab.path);
  if (tab.path == '/seller/sell') {
    return [_saleRoute('new'), _saleRoute('order', mode: SaleMode.order)];
  }
  if (tab.path == '/seller/more') {
    return [GoRoute(path: 'orders', builder: (_, _) => const MyOrdersScreen())];
  }
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
      _saleRoute('sell'),
      _saleRoute('order', mode: SaleMode.order),
      GoRoute(
        path: 'statement',
        builder: (_, state) =>
            ClientStatementScreen(clientId: state.pathParameters['clientId']!),
      ),
    ],
  ),
];

/// The basket of a van sale; `extra` is the [BasketClient] (none = comptoir).
GoRoute _saleRoute(String path, {SaleMode mode = SaleMode.direct}) => GoRoute(
  path: path,
  parentNavigatorKey: rootNavigatorKey,
  builder: (_, state) =>
      SaleScreen(client: state.extra as BasketClient?, mode: mode),
);

/// The seller's "Plus" menu, each entry only with its module / right.
List<MoreItem> sellerMenu(BuildContext context) {
  final user = context.watch<SessionCubit>().state.user;
  if (user == null) return const [];
  return [
    if (user.hasFeature(Feature.tournees))
      MoreItem(
        labelKey: 'order.mine',
        icon: Icons.receipt_long_outlined,
        onTap: (c) => c.push('/seller/more/orders'),
      ),
  ];
}
