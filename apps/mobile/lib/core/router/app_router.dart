import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/data/models/address.dart';
import '../../features/account/ui/account_screen.dart';
import '../../features/account/ui/address_form_screen.dart';
import '../../features/account/ui/addresses_screen.dart';
import '../../features/account/ui/change_password_screen.dart';
import '../../features/account/ui/edit_profile_screen.dart';
import '../../features/account/ui/help_center_screen.dart';
import '../../features/account/ui/privacy_policy_screen.dart';
import '../../features/auth/ui/forgot_password_screen.dart';
import '../../features/auth/ui/auth_screen.dart';
import '../../features/cart/ui/cart_screen.dart';
import '../../features/catalog/ui/category_group_products_screen.dart';
import '../../features/cart/data/models/cart_line.dart';
import '../../features/catalog/data/models/product.dart';
import '../../features/catalog/ui/product_details_screen.dart';
import '../../features/catalog/ui/product_list_screen.dart';
import '../../features/catalog/ui/store_details_screen.dart';
import '../../features/catalog/ui/store_list_screen.dart';
import '../../features/checkout/ui/checkout_screen.dart';
import '../../features/home/ui/home_tab_screen.dart';
import '../../features/main_screen/ui/main_screen.dart';
import '../../features/order/ui/my_orders_screen.dart';
import '../../features/order/ui/order_details_screen.dart';
import '../../features/order/ui/order_placed_screen.dart';
import '../../features/splash/ui/splash_screen.dart';
import '../config/category_groups.dart';
import '../di/dependency_injection.dart';
import '../localization/api_language_keyed.dart';
import '../session/session_cubit.dart';
import '../session/session_state.dart';
import 'routes.dart';

final _rootKey = GlobalKey<NavigatorState>();

/// Screens that need a signed-in client; guests are sent to login.
const _protected = [
  Routes.checkout,
  Routes.orders,
  Routes.editProfile,
  Routes.addresses,
  Routes.addressForm,
  Routes.changePassword,
];

final GoRouter appRouter = GoRouter(
  navigatorKey: _rootKey,
  initialLocation: Routes.splash,
  refreshListenable: _SessionListenable(getIt<SessionCubit>()),
  redirect: (context, state) {
    final SessionState session = getIt<SessionCubit>().state;
    final path = state.uri.path;
    final needsAuth =
        _protected.any(path.startsWith) || path.startsWith('/order-placed/');
    // While the splash is still restoring, the status is `unknown`.
    if (needsAuth && session.isGuest) {
      return Routes.login;
    }
    return null;
  },
  routes: [
    GoRoute(path: Routes.splash, builder: (_, _) => const LogoSplashScreen()),

    // Auth.
    GoRoute(path: Routes.auth, builder: (_, _) => const AuthScreen()),
    GoRoute(
      path: Routes.login,
      builder: (_, _) => const AuthScreen(initialPhase: AuthPhase.login),
    ),
    GoRoute(
      path: Routes.register,
      builder: (_, _) => const AuthScreen(initialPhase: AuthPhase.signup),
    ),
    GoRoute(
      path: Routes.forgotPassword,
      builder: (_, _) => const ForgotPasswordScreen(),
    ),

    // Catalog (root level so they cover the bottom bar).
    GoRoute(
      path: '/product/:id',
      builder: (_, state) => ProductDetailsScreen(
        productId: state.pathParameters['id']!,
        // A cart line opened to edit its size / options.
        editLine: state.extra is CartLine ? state.extra as CartLine : null,
        // The card's copy, so the photo is there for the Hero while loading.
        preview: state.extra is Product ? state.extra as Product : null,
      ),
    ),
    GoRoute(
      path: '/store/:id',
      builder: (_, state) =>
          StoreDetailsScreen(storeId: state.pathParameters['id']!),
    ),
    GoRoute(path: Routes.stores, builder: (_, _) => const StoreListScreen()),
    GoRoute(
      path: Routes.search,
      builder: (context, state) => ProductListScreen(
        args: state.extra is ProductListArgs
            ? state.extra! as ProductListArgs
            : ProductListArgs.search(''),
      ),
    ),

    // Cart & orders.
    GoRoute(path: Routes.cart, builder: (_, _) => const CartScreen()),
    GoRoute(path: Routes.checkout, builder: (_, _) => const CheckoutScreen()),
    GoRoute(
      path: '/order-placed/:id',
      builder: (_, state) =>
          OrderPlacedScreen(orderId: state.pathParameters['id']!),
    ),
    GoRoute(path: Routes.orders, builder: (_, _) => const MyOrdersScreen()),
    GoRoute(
      path: '/orders/:id',
      builder: (_, state) =>
          OrderDetailsScreen(orderId: state.pathParameters['id']!),
    ),

    // Account.
    GoRoute(
      path: Routes.editProfile,
      builder: (_, _) => const EditProfileScreen(),
    ),
    GoRoute(path: Routes.addresses, builder: (_, _) => const AddressesScreen()),
    GoRoute(
      path: Routes.addressForm,
      builder: (_, state) => AddressFormScreen(
        address: state.extra is Address ? state.extra! as Address : null,
      ),
    ),
    GoRoute(
      path: Routes.changePassword,
      builder: (_, _) => const ChangePasswordScreen(),
    ),
    GoRoute(
      path: Routes.helpCenter,
      builder: (_, _) => const HelpCenterScreen(),
    ),
    GoRoute(
      path: Routes.privacyPolicy,
      builder: (_, _) => const PrivacyPolicyScreen(),
    ),

    // The four tabs. Branch order = bottom bar order.
    StatefulShellRoute.indexedStack(
      builder: (_, _, shell) => MainScreen(navigationShell: shell),
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: Routes.home,
              builder: (_, _) => const ApiLanguageKeyed(child: HomeTabScreen()),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: Routes.produce,
              builder: (_, _) => const ApiLanguageKeyed(
                child: CategoryGroupProductsScreen(
                  group: CategoryGroup.produce,
                ),
              ),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: Routes.supermarket,
              builder: (_, _) => const ApiLanguageKeyed(
                child: CategoryGroupProductsScreen(
                  group: CategoryGroup.supermarket,
                ),
              ),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: Routes.account,
              builder: (_, _) => const AccountScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
  errorBuilder: (context, state) => Scaffold(
    appBar: AppBar(),
    body: Center(child: Text(state.uri.path)),
  ),
);

/// Re-runs the redirect when the user signs in or out.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(SessionCubit cubit) {
    cubit.stream.listen((_) => notifyListeners());
  }
}
