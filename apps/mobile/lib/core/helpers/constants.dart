class SharedPrefKeys {
  static const String userToken = 'userToken';
  static const String refreshToken = 'refreshToken';
  static const String role = 'role';
  static const String id = 'id';
  static const String email = 'email';
  static const String username = 'username';
  static const String isAdmin = 'isAdmin';
  static const String userData = 'userData';
  bool isLoggedInUser = false;
  static const String remember = 'remember';
  static const String lastNotificationCheckTime = 'lastNotificationCheckTime';
  static const String isnotfirstTime = 'firstTime';
  static const String emailOtp = 'emailOtp';
  static const String userTokenOtp = 'userTokenOtp';
  static const String likedProducts = 'likedProducts';
}

class Connectionresfrech {
  static bool resfrechAfterconn = false;
}

class NewNotifications {
  static bool hasNewNotificationsIcon = false;
}

// Global connectivity state
class ConnectivityState {
  static bool isOffline = false;
}

bool firstTime = true;

int pageNumberProperty = 1;

void clearPageNumbers() {
  pageNumberProperty = 1;
}
