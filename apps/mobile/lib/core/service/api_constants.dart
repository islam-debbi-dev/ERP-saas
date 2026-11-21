class ApiConstants {
  static const String authLogin = '/auth/login';
  static const String authRegister = '/auth/register';
  static String authWithSocailMedia(String provider) => '/auth/$provider';
  static const String userMe = '/users/me';
  static const String userPushToken = '/users/me/push-token';

  // ── Notification Inbox ──────────────────────────────────────────────────
  static const String notificationsMe = '/notifications/me';
  static String notificationMarkRead(String id) => '/notifications/$id/read';
  static const String notificationsMarkAllRead = '/notifications/me/read-all';

  static const String productsHomepage = '/products/homepage';
  static const String searchByImage = '/search/image';
  static String storeProducts(String storeId) => '/products/store/$storeId';
  static const String products = '/products';
  static const String stores = '/stores';
  static const String storesMine = '/stores/mine';
  static const String orders = '/orders';
  static const String ordersMe = '/orders/me';
  static const String ordersStoreIncoming = '/orders/store/incoming';
  static const String deliveryAvailable = '/delivery/available';
  static const String deliveryMine = '/delivery/mine';
  static String deliveryAccept(String orderId) => '/delivery/$orderId/accept';
  static String deliveryComplete(String orderId) =>
      '/delivery/$orderId/complete';
  static const String analyticsDashboard = '/analytics/dashboard';
  static const String analyticsInsights = '/analytics/insights';
}

class ApiErrors {
  static const String badRequestError = "badRequestError";
  static const String noContent = "noContent";
  static const String forbiddenError = "forbiddenError";
  static const String unauthorizedError = "unauthorizedError";
  static const String notFoundError = "notFoundError";
  static const String conflictError = "conflictError";
  static const String internalServerError = "internalServerError";
  static const String unknownError = "unknownError";
  static const String timeoutError = "timeoutError";
  static const String defaultError = "defaultError";
  static const String cacheError = "cacheError";
  static const String noInternetError = "noInternetError";
  static const String loadingMessage = "loadingMessage";
  static const String retryAgainMessage = "retryAgainMessage";
  static const String ok = "ok";
}
