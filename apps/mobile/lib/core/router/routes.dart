/// Client app routes. Tabs live in the shell; everything else is pushed on
/// the root navigator so it covers the bottom bar.
class Routes {
  Routes._();

  // Launch.
  static const splash = '/splash';

  // Tabs.
  static const home = '/home';
  static const produce = '/produce';
  static const supermarket = '/supermarket';
  static const account = '/account';

  // Catalog.
  static String product(String id) => '/product/$id';
  static String store(String id) => '/store/$id';
  static const stores = '/stores';
  static const search = '/search';

  // Cart & orders.
  static const cart = '/cart';
  static const checkout = '/checkout';
  static String orderPlaced(String id) => '/order-placed/$id';
  static const orders = '/orders';
  static String order(String id) => '/orders/$id';

  // Account.
  static const editProfile = '/account/edit';
  static const addresses = '/account/addresses';
  static const addressForm = '/account/addresses/form';
  static const changePassword = '/account/password';
  static const helpCenter = '/account/help';
  static const privacyPolicy = '/account/privacy';

  // Auth.
  /// Welcome sheet: sign in, create account or continue as guest.
  static const auth = '/auth';
  static const login = '/login';
  static const register = '/register';
  static const forgotPassword = '/forgot-password';
}
