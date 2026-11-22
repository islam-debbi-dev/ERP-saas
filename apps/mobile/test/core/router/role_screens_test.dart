import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/router/app_router.dart'
    show sessionRedirect;
import 'package:orvynt_starter/core/router/role_screens.dart';
import 'package:orvynt_starter/core/router/routes.dart';
import 'package:orvynt_starter/core/session/session_state.dart';

/// Role defaults of the API (packages/shared/src/permissions.ts), trimmed to
/// what the tabs read.
const _defaults = {
  'SELLER': ['SALES_CREATE', 'PAYMENTS_CREATE', 'CLIENTS_CREATE'],
  'LIVREUR': <String>[],
  'SUPERVISOR': <String>[],
  'STOREKEEPER': ['STOCK_COUNT', 'STOCK_TRANSFER', 'PURCHASES_CREATE'],
};

AuthUser user(
  String role, {
  List<String>? permissions,
  List<String> features = const ['MOBILE_APP', 'WAREHOUSES', 'TOURNEES'],
}) => AuthUser(
  id: 'u',
  fullName: 'U',
  role: role,
  tenantId: 't',
  tenantName: 'Demo',
  edition: 'DISTRIBUTION',
  permissions: permissions ?? _defaults[role] ?? const [],
  features: features,
);

List<String> paths(AuthUser u) =>
    RoleScreens.visibleTabsFor(u).map((t) => t.path).toList();

void main() {
  group('RoleScreens table', () {
    test('each field role has its own tabs, Plus last', () {
      expect(paths(user('SELLER')), [
        '/seller/today',
        '/seller/clients',
        '/seller/sell',
        '/seller/truck',
        '/seller/more',
      ]);
      expect(paths(user('LIVREUR')), [
        '/livreur/deliveries',
        '/livreur/clients',
        '/livreur/truck',
        '/livreur/more',
      ]);
      expect(paths(user('SUPERVISOR')), [
        '/supervisor/team',
        '/supervisor/orders',
        '/supervisor/controls',
        '/supervisor/more',
      ]);
      expect(paths(user('STOREKEEPER')), [
        '/storekeeper/loads',
        '/storekeeper/trucks',
        '/storekeeper/inventory',
        '/storekeeper/more',
      ]);
    });

    test('a revoked permission hides its tab', () {
      final seller = user('SELLER', permissions: const ['PAYMENTS_CREATE']);
      expect(paths(seller), isNot(contains('/seller/sell')));
      expect(RoleScreens.allows(seller, '/seller/sell'), isFalse);
    });

    test('a module off hides its tabs', () {
      final mag = user('STOREKEEPER', features: const ['MOBILE_APP']);
      expect(paths(mag), ['/storekeeper/inventory', '/storekeeper/more']);
    });

    test('home is the first visible tab', () {
      expect(RoleScreens.homeFor(user('SELLER')), '/seller/today');
      expect(RoleScreens.homeFor(user('LIVREUR')), '/livreur/deliveries');
      final mag = user(
        'STOREKEEPER',
        permissions: const [],
        features: const ['MOBILE_APP'],
      );
      expect(RoleScreens.homeFor(mag), '/storekeeper/more');
    });

    test('sub-screens of an own tab are allowed', () {
      expect(RoleScreens.allows(user('SELLER'), '/seller/clients/c1'), isTrue);
      expect(RoleScreens.allows(user('SELLER'), '/seller/clientsX'), isFalse);
    });
  });

  group('sessionRedirect', () {
    test('signed-in users land on their role home', () {
      final s = SessionState.signedIn(user('LIVREUR'));
      expect(sessionRedirect(s, Routes.home), '/livreur/deliveries');
      expect(sessionRedirect(s, Routes.login), '/livreur/deliveries');
    });

    test('a deep link to another role is refused', () {
      final seller = SessionState.signedIn(user('SELLER'));
      expect(sessionRedirect(seller, '/livreur/deliveries'), '/seller/today');
      expect(sessionRedirect(seller, '/supervisor/team'), '/seller/today');
      expect(sessionRedirect(seller, '/storekeeper/loads/l1'), '/seller/today');
      final livreur = SessionState.signedIn(user('LIVREUR'));
      expect(sessionRedirect(livreur, '/seller/sell'), '/livreur/deliveries');
    });

    test('a livreur keeps to his four tabs and their screens', () {
      final s = SessionState.signedIn(user('LIVREUR'));
      expect(paths(user('LIVREUR')), [
        '/livreur/deliveries',
        '/livreur/clients',
        '/livreur/truck',
        '/livreur/more',
      ]);
      expect(sessionRedirect(s, '/livreur/deliveries/o1'), isNull);
      expect(sessionRedirect(s, '/livreur/clients/c1/statement'), isNull);
      expect(sessionRedirect(s, '/livreur/more/deliveries'), isNull);
      expect(
        sessionRedirect(s, '/seller/clients/c1/sell'),
        '/livreur/deliveries',
      );
      expect(
        sessionRedirect(s, '/supervisor/orders/o1'),
        '/livreur/deliveries',
      );
    });

    test('only order-taking roles take orders', () {
      expect(user('SELLER').canTakeOrders, isTrue);
      expect(user('SUPERVISOR').canTakeOrders, isTrue);
      expect(user('LIVREUR').canTakeOrders, isFalse);
      expect(
        user('SELLER', features: const ['MOBILE_APP']).canTakeOrders,
        isFalse,
      );
    });

    test('own tabs and common screens stay', () {
      final s = SessionState.signedIn(user('SUPERVISOR'));
      expect(sessionRedirect(s, '/supervisor/orders'), isNull);
      expect(sessionRedirect(s, Routes.changePassword), isNull);
    });

    test('session states pin their screen', () {
      expect(
        sessionRedirect(const SessionState.signedOut(), '/seller/today'),
        Routes.login,
      );
      expect(
        sessionRedirect(
          SessionState.mustChangePassword(user('SELLER')),
          '/seller/today',
        ),
        Routes.passwordRequired,
      );
      expect(
        sessionRedirect(
          const SessionState.refused(Refusal.officeRole),
          Routes.home,
        ),
        Routes.refused,
      );
      expect(
        sessionRedirect(const SessionState.unknown(), '/seller/today'),
        Routes.splash,
      );
      expect(
        sessionRedirect(const SessionState.unknown(), Routes.splash),
        isNull,
      );
    });
  });
}
