import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../config/app_version.dart';

class DeviceHelper {
  DeviceHelper._();

  static final _deviceInfo = DeviceInfoPlugin();

  /// The `deviceName` sent at login, shown in the owner's sessions screen:
  /// `"Samsung SM-A515F · Debvora 1.1.0"` (max 100 chars, the API's limit).
  static Future<String> deviceName() async {
    var model = 'Phone';
    try {
      if (!kIsWeb && Platform.isAndroid) {
        final a = await _deviceInfo.androidInfo;
        model = '${_capitalize(a.manufacturer)} ${a.model}'.trim();
      } else if (!kIsWeb && Platform.isIOS) {
        final i = await _deviceInfo.iosInfo;
        model = i.utsname.machine.isNotEmpty ? i.utsname.machine : i.model;
      }
    } catch (_) {
      // No device info (tests, desktop): keep the generic name.
    }
    final name = '$model · Debvora $appVersion';
    return name.length > 100 ? name.substring(0, 100) : name;
  }

  static String _capitalize(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}
