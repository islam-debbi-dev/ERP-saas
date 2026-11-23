import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/ui/account_screen.dart';
import '../../features/assistant/logic/assistant_status_cubit.dart';
import '../../features/assistant/ui/assistant_screen.dart';
import '../../features/clients/ui/client_detail_screen.dart';
import '../../features/clients/ui/client_statement_screen.dart';
import '../../features/clients/ui/clients_screen.dart';
import '../../features/clients/ui/new_client_screen.dart';
import '../../features/controls/ui/controls_screen.dart';
import '../../features/delivery/ui/deliveries_screen.dart';
import '../../features/delivery/ui/my_deliveries_screen.dart';
import '../../features/delivery/ui/order_delivery_screen.dart';
import '../../features/inventory/ui/inventories_screen.dart';
import '../../features/inventory/ui/inventory_count_screen.dart';
import '../../features/main_screen/ui/placeholder_tab.dart';
import '../../features/objectives/ui/objectives_screen.dart';
import '../../features/objectives/ui/team_objectives_screen.dart';
import '../../features/orders/ui/my_orders_screen.dart';
import '../../features/payments/ui/my_payments_screen.dart';
import '../../features/payments/ui/versement_screen.dart';
import '../helpers/algiers_day.dart';
import '../models/auth_user.dart';
import '../models/erp_codes.dart';
import '../session/session_cubit.dart';
import '../../features/sales/logic/basket.dart';
import '../../features/sales/ui/my_sales_screen.dart';
import '../../features/sales/ui/sale_screen.dart';
import '../../features/sales/ui/sell_screen.dart';
import '../../features/stock_transfers/data/transfer_models.dart';
import '../../features/stock_transfers/ui/transfer_detail_screen.dart';
import '../../features/stock_transfers/ui/transfer_form_screen.dart';
import '../../features/stock_transfers/ui/transfers_screen.dart';
import '../../features/stock_transfers/ui/trucks_screen.dart';
import '../../features/team/ui/member_day_screen.dart';
import '../../features/team/ui/team_screen.dart';
import '../../features/team_orders/ui/team_orders_screen.dart';
import '../../features/today/ui/today_screen.dart';
import '../../features/truck/ui/truck_screen.dart';
import '../../features/visits/logic/visit_form.dart';
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
        onOpenClient: (context, stop) => context.push(
          '/seller/today/client/${stop.client.id}',
          extra: VisitStart(
            startedAt: DateTime.now(),
            routeId: stop.routeId,
            docs: VisitDocs(
              saleId: stop.today.saleId,
              orderId: stop.today.orderId,
              paymentId: stop.today.paymentId,
            ),
          ),
        ),
        onOpenClients: () => context.go('/seller/clients'),
        onOpenClientId: (context, id) =>
            context.push('/seller/today/client/$id'),
      ),
    );
  }
  if (p == '/seller/clients' || p == '/livreur/clients') {
    return ClientsScreen(basePath: p);
  }
  if (p == '/seller/sell') return SellScreen(basePath: p);
  if (p == '/seller/truck' || p == '/livreur/truck') {
    return const TruckScreen();
  }
  if (p == '/livreur/deliveries') {
    return DeliveriesScreen(
      tabPath: p,
      onOpenOrder: (context, order) => context.push('$p/${order.id}'),
      onOpenClient: (context, id) => context.push('$p/client/$id'),
    );
  }
  if (p == '/supervisor/team') {
    return TeamScreen(
      onOpenMember: (context, member, date) =>
          context.push('$p/${member.seller.id}?date=$date'),
    );
  }
  if (p == '/supervisor/orders') return TeamOrdersScreen(tabPath: p);
  if (p == '/supervisor/controls') return const ControlsScreen();
  if (p == '/storekeeper/trucks') return TrucksScreen(basePath: p);
  if (p == '/storekeeper/inventory') return InventoriesScreen(basePath: p);
  if (p == '/storekeeper/loads') {
    return Builder(
      builder: (context) => TransfersScreen(
        basePath: p,
        canCreate:
            context.watch<SessionCubit>().state.user?.can(
              Permission.stockTransfer,
            ) ??
            false,
      ),
    );
  }
  if (p == '/seller/more') {
    return Builder(
      builder: (context) => AccountScreen(menu: sellerMenu(context)),
    );
  }
  if (p == '/livreur/more') {
    return Builder(
      builder: (context) => AccountScreen(menu: livreurMenu(context)),
    );
  }
  if (p == '/supervisor/more') {
    return Builder(
      builder: (context) => AccountScreen(menu: supervisorMenu(context)),
    );
  }
  if (p == '/storekeeper/more') {
    return Builder(
      builder: (context) => AccountScreen(menu: storekeeperMenu(context)),
    );
  }
  if (p.endsWith('/more')) return const AccountScreen();
  return PlaceholderTab(tab: tab);
}

/// Screens under a tab (`<tab>/:id`...). Their paths start with the tab's,
/// so `RoleScreens.allows` keeps them to the tab's role.
List<RouteBase> tabSubRoutes(RoleTab tab) {
  if (tab.path == '/seller/clients' || tab.path == '/livreur/clients') {
    return clientRoutes(tab.path);
  }
  if (tab.path == '/seller/today') {
    return [clientDetailRoute(tab.path, prefix: 'client/')];
  }
  if (tab.path == '/seller/sell') {
    return [
      _saleRoute('new'),
      _saleRoute('order', mode: SaleMode.order, needsClient: true),
    ];
  }
  if (tab.path == '/livreur/deliveries') {
    return [
      // The map's "Ouvrir la fiche": the client stays in this tab.
      clientDetailRoute(tab.path, prefix: 'client/'),
      GoRoute(
        path: ':orderId',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, state) =>
            OrderDeliveryScreen(orderId: state.pathParameters['orderId']!),
      ),
    ];
  }
  if (tab.path == '/supervisor/team') {
    return [
      GoRoute(
        path: ':sellerId',
        builder: (_, state) => MemberDayScreen(
          sellerId: state.pathParameters['sellerId']!,
          date: state.uri.queryParameters['date'] ?? AlgiersDay.of(),
        ),
      ),
    ];
  }
  if (tab.path == '/storekeeper/loads') return transferRoutes();
  if (tab.path == '/seller/truck' || tab.path == '/livreur/truck') {
    return [grantedLoadsRoute('${tab.path}/loads')];
  }
  if (tab.path == '/storekeeper/trucks') return truckRoutes();
  if (tab.path == '/storekeeper/inventory') {
    return [
      GoRoute(
        path: ':inventoryId',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, state) => InventoryCountScreen(
          inventoryId: state.pathParameters['inventoryId']!,
        ),
      ),
    ];
  }
  if (tab.path == '/supervisor/more') {
    return [
      GoRoute(
        path: 'objectives',
        builder: (_, _) => const TeamObjectivesScreen(),
      ),
      assistantRoute(),
      grantedLoadsRoute('/supervisor/more/loads'),
    ];
  }
  if (tab.path == '/storekeeper/more') {
    return [assistantRoute()];
  }
  if (tab.path == '/livreur/more') {
    return [
      GoRoute(
        path: 'deliveries',
        builder: (_, _) => const MyDeliveriesScreen(),
      ),
      GoRoute(path: 'payments', builder: (_, _) => const MyPaymentsScreen()),
      assistantRoute(),
    ];
  }
  if (tab.path == '/seller/more') {
    return [
      GoRoute(path: 'orders', builder: (_, _) => const MyOrdersScreen()),
      GoRoute(path: 'payments', builder: (_, _) => const MyPaymentsScreen()),
      GoRoute(path: 'sales', builder: (_, _) => const MySalesScreen()),
      GoRoute(path: 'objectives', builder: (_, _) => const ObjectivesScreen()),
      assistantRoute(),
    ];
  }
  return const [];
}

/// A chargement / déchargement under a list: `[list]/new` (`?truck=` picks
/// the truck; `?type=UNLOAD&rest=1` is the evening déchargement of its rest), `[list]/:transferId` and its `edit`. Every screen needs
/// STOCK_TRANSFER: without it a deep link goes back to the list. The forms
/// cover the bottom bar (root navigator).
List<RouteBase> transferRoutes() {
  String? needsTransfer(BuildContext context, GoRouterState state) =>
      _needsRight(context, state, (u) => u.can(Permission.stockTransfer));
  return [
    GoRoute(
      path: 'new',
      parentNavigatorKey: rootNavigatorKey,
      redirect: needsTransfer,
      builder: (_, state) {
        final q = state.uri.queryParameters;
        final unload = q['type'] == TransferType.unload;
        return TransferFormScreen(
          type: unload ? TransferType.unload : TransferType.load,
          truckId: q['truck'],
          unloadRest: unload && q['rest'] == '1',
        );
      },
    ),
    GoRoute(
      path: ':transferId',
      redirect: needsTransfer,
      builder: (_, state) => TransferDetailScreen(
        transferId: state.pathParameters['transferId']!,
        editPath: '${state.uri.path}/edit',
      ),
      routes: [
        GoRoute(
          path: 'edit',
          parentNavigatorKey: rootNavigatorKey,
          redirect: needsTransfer,
          builder: (_, state) => TransferFormScreen(
            transferId: state.pathParameters['transferId']!,
          ),
        ),
      ],
    ),
  ];
}

/// The chargement screens for a field user the owner granted
/// STOCK_TRANSFER (seller, livreur from "Mon camion", supervisor from Plus):
/// `[path]` lists them (`?truck=` keeps it to one truck), and every screen
/// under it is the magasinier's. Without the grant (or the module) the
/// route goes back to the parent.
GoRoute grantedLoadsRoute(String path) => GoRoute(
  path: 'loads',
  redirect: (context, state) => _needsRight(
    context,
    state,
    (u) => u.can(Permission.stockTransfer) && u.hasFeature(Feature.warehouses),
  ),
  builder: (_, state) => TransfersScreen(
    basePath: path,
    truckId: state.uri.queryParameters['truck'],
    isTabRoot: false,
    canCreate: true,
  ),
  routes: transferRoutes(),
);

/// A truck's stock (`/storekeeper/trucks/:truckId`), and from it a
/// chargement (`load`) or the evening déchargement of its rest (`unload`):
/// the forms need STOCK_TRANSFER.
List<RouteBase> truckRoutes() {
  String? needsTransfer(BuildContext context, GoRouterState state) =>
      _needsRight(context, state, (u) => u.can(Permission.stockTransfer));
  return [
    GoRoute(
      path: ':truckId',
      builder: (_, state) => TruckStockScreen(
        truckId: state.pathParameters['truckId']!,
        basePath: state.uri.path,
      ),
      routes: [
        GoRoute(
          path: 'load',
          parentNavigatorKey: rootNavigatorKey,
          redirect: needsTransfer,
          builder: (_, state) =>
              TransferFormScreen(truckId: state.pathParameters['truckId']),
        ),
        GoRoute(
          path: 'unload',
          parentNavigatorKey: rootNavigatorKey,
          redirect: needsTransfer,
          builder: (_, state) => TransferFormScreen(
            type: TransferType.unload,
            truckId: state.pathParameters['truckId'],
            unloadRest: true,
          ),
        ),
      ],
    ),
  ];
}

/// Client list → new client, client detail (and its actions), statement.
List<RouteBase> clientRoutes(String base) => [
  GoRoute(
    path: 'new',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, _) => const NewClientScreen(),
  ),
  clientDetailRoute(base),
];

/// A client and its actions at `[base]/[prefix]:clientId`; Today opens its
/// stops at `/seller/today/client/:clientId` so they stay in that tab.
GoRoute clientDetailRoute(String base, {String prefix = ''}) => GoRoute(
  path: '$prefix:clientId',
  builder: (_, state) {
    final id = state.pathParameters['clientId']!;
    return ClientDetailScreen(
      clientId: id,
      basePath: '$base/$prefix$id',
      visit: state.extra is VisitStart ? state.extra! as VisitStart : null,
    );
  },
  routes: [
    _saleRoute('sell', needsClient: true),
    _saleRoute('order', mode: SaleMode.order, needsClient: true),
    GoRoute(
      path: 'versement',
      parentNavigatorKey: rootNavigatorKey,
      redirect: (context, state) =>
          _needsRight(
            context,
            state,
            (u) => u.can(Permission.paymentsCreate),
          ) ??
          _needsClient(context, state),
      builder: (_, state) =>
          VersementScreen(client: state.extra! as BasketClient),
    ),
    GoRoute(
      path: 'statement',
      builder: (_, state) =>
          ClientStatementScreen(clientId: state.pathParameters['clientId']!),
    ),
  ],
);

/// The basket of a sale or an order; `extra` is the [BasketClient]
/// (none = vente comptoir, only from the Vendre tab).
GoRoute _saleRoute(
  String path, {
  SaleMode mode = SaleMode.direct,
  bool needsClient = false,
}) => GoRoute(
  path: path,
  parentNavigatorKey: rootNavigatorKey,
  redirect: (context, state) =>
      _needsRight(
        context,
        state,
        (u) => mode == SaleMode.order
            ? u.canTakeOrders
            : u.can(Permission.salesCreate),
      ) ??
      (needsClient ? _needsClient(context, state) : null),
  builder: (_, state) =>
      SaleScreen(client: state.extra as BasketClient?, mode: mode),
);

/// A form the user has no right to (a livreur on `…/sell`, a seller whose
/// PAYMENTS_CREATE was revoked on `…/versement`) goes back to the parent
/// screen. The API refuses it anyway; this keeps the phone from offering it.
String? _needsRight(
  BuildContext context,
  GoRouterState state,
  bool Function(AuthUser user) allowed,
) {
  final user = context.read<SessionCubit>().state.user;
  if (user != null && allowed(user)) return null;
  final path = state.uri.path;
  return path.substring(0, path.lastIndexOf('/'));
}

/// A form that needs its client as `extra`: a deep link without one goes
/// back to the parent screen.
String? _needsClient(BuildContext _, GoRouterState state) {
  if (state.extra is BasketClient) return null;
  final path = state.uri.path;
  return path.substring(0, path.lastIndexOf('/'));
}

/// The seller's "Plus" menu, each entry only with its module / right.
List<MoreItem> sellerMenu(BuildContext context) {
  final user = context.watch<SessionCubit>().state.user;
  if (user == null) return const [];
  return [
    if (user.hasFeature(Feature.incentives))
      MoreItem(
        labelKey: 'objectives.title',
        icon: Icons.flag_outlined,
        onTap: (c) => c.push('/seller/more/objectives'),
      ),
    MoreItem(
      labelKey: 'sale.mine',
      icon: Icons.receipt_outlined,
      onTap: (c) => c.push('/seller/more/sales'),
    ),
    if (user.hasFeature(Feature.tournees))
      MoreItem(
        labelKey: 'order.mine',
        icon: Icons.receipt_long_outlined,
        onTap: (c) => c.push('/seller/more/orders'),
      ),
    if (user.can(Permission.paymentsCreate))
      MoreItem(
        labelKey: 'versement.mine',
        icon: Icons.payments_outlined,
        onTap: (c) => c.push('/seller/more/payments'),
      ),
    ...assistantItem(context, '/seller/more'),
  ];
}

/// The livreur's "Plus" menu: his deliveries, and his versements only when
/// PAYMENTS_CREATE was granted to him.
List<MoreItem> livreurMenu(BuildContext context) {
  final user = context.watch<SessionCubit>().state.user;
  if (user == null) return const [];
  return [
    MoreItem(
      labelKey: 'delivery.history',
      icon: Icons.inventory_2_outlined,
      onTap: (c) => c.push('/livreur/more/deliveries'),
    ),
    if (user.can(Permission.paymentsCreate))
      MoreItem(
        labelKey: 'versement.mine',
        icon: Icons.payments_outlined,
        onTap: (c) => c.push('/livreur/more/payments'),
      ),
    ...assistantItem(context, '/livreur/more'),
  ];
}

/// The supervisor's "Plus" menu: his team's targets (INCENTIVES), the
/// chargements when the owner granted him STOCK_TRANSFER, and the assistant
/// (when `GET /assistant/status` says available). Account, language and theme
/// follow in [AccountScreen].
List<MoreItem> supervisorMenu(BuildContext context) {
  final user = context.watch<SessionCubit>().state.user;
  if (user == null) return const [];
  return [
    if (user.hasFeature(Feature.incentives))
      MoreItem(
        labelKey: 'objectives.team_title',
        icon: Icons.flag_outlined,
        onTap: (c) => c.push('/supervisor/more/objectives'),
      ),
    if (user.can(Permission.stockTransfer) &&
        user.hasFeature(Feature.warehouses))
      MoreItem(
        labelKey: 'transfer.title',
        icon: Icons.move_to_inbox_outlined,
        onTap: (c) => c.push('/supervisor/more/loads'),
      ),
    ...assistantItem(context, '/supervisor/more'),
  ];
}

/// The magasinier's "Plus" menu: the assistant (when
/// `GET /assistant/status` says available). Account, language and theme follow in
/// [AccountScreen].
List<MoreItem> storekeeperMenu(BuildContext context) {
  final user = context.watch<SessionCubit>().state.user;
  if (user == null) return const [];
  return [...assistantItem(context, '/storekeeper/more')];
}

/// The assistant entry of a role's "Plus" ([more] is its path): only when
/// `GET /assistant/status` says available (flag, permission, provider).
List<MoreItem> assistantItem(BuildContext context, String more) => [
  if (context.watch<AssistantStatusCubit>().state.available)
    MoreItem(
      labelKey: 'assistant.title',
      icon: Icons.auto_awesome_outlined,
      onTap: (c) => c.push('$more/assistant'),
    ),
];

/// `[more]/assistant`. Without the assistant (status not available) a deep
/// link goes back to "Plus".
GoRoute assistantRoute() => GoRoute(
  path: 'assistant',
  redirect: (context, state) {
    if (context.read<AssistantStatusCubit>().state.available) return null;
    final path = state.uri.path;
    return path.substring(0, path.lastIndexOf('/assistant'));
  },
  builder: (_, _) => const AssistantScreen(),
);
