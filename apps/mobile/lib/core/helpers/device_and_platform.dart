import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:uuid/uuid.dart';
import 'shared_pref_helper.dart';

class DeviceHelper {
  static final _deviceInfo = DeviceInfoPlugin();

  static Future<Map<String, String>> getDeviceData() async {
    String deviceId = "unknown";
    String platform = Platform.isAndroid ? "android" : "ios";

    try {
      if (Platform.isAndroid) {
        final android = await _deviceInfo.androidInfo;
        deviceId = android.id; // may change after reset
      } else if (Platform.isIOS) {
        final ios = await _deviceInfo.iosInfo;
        deviceId = ios.identifierForVendor ?? "unknown";
      }
    } catch (_) {}

    // if still "unknown", generate and cache a UUID in SharedPref
    if (deviceId == "unknown") {
      final saved = await SharedPrefHelper.getString("custom_device_id");
      if (saved.isNotEmpty) {
        deviceId = saved;
      } else {
        deviceId = const Uuid().v4();
        await SharedPrefHelper.setData("custom_device_id", deviceId);
      }
    }

    return {"deviceId": deviceId, "platform": platform};
  }
}
