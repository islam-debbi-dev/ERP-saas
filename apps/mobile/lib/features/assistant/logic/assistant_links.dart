import '../../../core/models/auth_user.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/router/role_screens.dart';

/// Where a link of an answer leads on the phone.
sealed class LinkTarget {
  const LinkTarget();
}

/// A route of the app. A route of the chat's own tab ("Plus") is pushed,
/// so Back returns to the chat; a route of another tab is gone to
/// (go_router loses the location when a push across shell branches is
/// popped), and the Plus tab keeps the chat where it was.
class AppRouteTarget extends LinkTarget {
  const AppRouteTarget(this.path);
  final String path;

  bool get inChatTab => path.split('/').elementAtOrNull(2) == 'more';
}

/// A sale's detail page, as "Mes ventes" / "Mes livraisons" open it.
class SalePageTarget extends LinkTarget {
  const SalePageTarget(this.saleId);
  final String saleId;
}

/// An order's detail page, as "Mes commandes" opens it.
class OrderPageTarget extends LinkTarget {
  const OrderPageTarget(this.orderId);
  final String orderId;
}

/// A screen the app does not have: the web dashboard, in the browser.
class WebTarget extends LinkTarget {
  const WebTarget(this.url);
  final Uri url;
}

/// Maps the **web paths** the assistant links to (`apps/api/src/assistant`:
/// `/clients/:id`, `/ventes/:id`, `/versements`, `/stock/:id`...) to the
/// screens the user's role has on the phone; every other path opens on the
/// dashboard. Pure Dart, so the table is unit-tested.
///
/// The phone adds no right here: each target is a screen the role already
/// reaches from its own menus, and the API scopes what it shows.
class AssistantLinks {
  AssistantLinks._();

  static final _uuid = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    caseSensitive: false,
  );

  /// Null when [href] cannot be followed: not a path of the web app
  /// (`https://…`, `//host`), or a dashboard path while [dashboardUrl] is
  /// not configured.
  static LinkTarget? resolve(
    String href,
    AuthUser user, {
    required String dashboardUrl,
  }) {
    if (!href.startsWith('/') || href.startsWith('//')) return null;
    final path = href.split(RegExp('[?#]')).first;
    final parts = path.split('/').skip(1).toList();
    final app = _inApp(parts, user);
    if (app != null) return app;
    if (dashboardUrl.isEmpty) return null;
    return WebTarget(Uri.parse('$dashboardUrl$href'));
  }

  static LinkTarget? _inApp(List<String> parts, AuthUser user) {
    final role = user.role;
    final seller = role == Role.seller;
    final livreur = role == Role.livreur;
    final id = parts.length == 2 && _uuid.hasMatch(parts[1]) ? parts[1] : null;

    LinkTarget? route(String path) =>
        RoleScreens.allows(user, path) ? AppRouteTarget(path) : null;

    switch (parts.first) {
      case 'clients' when id != null:
        if (seller) return route('/seller/clients/$id');
        if (livreur) return route('/livreur/clients/$id');
      case 'ventes' when id != null:
        if (seller || livreur) return SalePageTarget(id);
      case 'commandes' when id != null:
        if (seller && user.hasFeature(Feature.tournees)) {
          return OrderPageTarget(id);
        }
        if (livreur) return route('/livreur/deliveries/$id');
      case 'versements' when parts.length == 1:
        if (!user.can(Permission.paymentsCreate)) return null;
        if (seller) return route('/seller/more/payments');
        if (livreur) return route('/livreur/more/payments');
    }
    return null;
  }
}
