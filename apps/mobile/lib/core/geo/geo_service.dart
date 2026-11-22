import 'dart:async';

import 'package:geolocator/geolocator.dart';

import 'geo_fix.dart';

/// Where the app stands with the location permission.
enum GeoAccess {
  granted,

  /// Never asked, or refused once: the app may explain and ask again.
  askable,

  /// Refused for good or the location service is off: only the settings help.
  blocked,
}

/// Reads the device position once, when an operation is saved. Never runs in
/// the background (loi 18-07). A timeout or a refusal gives null: the request
/// goes without a position and the API decides (NO_SIGNAL).
abstract class GeoService {
  Future<GeoAccess> access();

  /// Asks the system permission; true when granted.
  Future<bool> request();

  /// High accuracy, at most [timeout]. Null when no position could be read.
  Future<GeoFix?> capture({Duration timeout = const Duration(seconds: 10)});

  Future<void> openSettings();
}

class DeviceGeoService implements GeoService {
  @override
  Future<GeoAccess> access() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return GeoAccess.blocked;
      }
      switch (await Geolocator.checkPermission()) {
        case LocationPermission.always:
        case LocationPermission.whileInUse:
          return GeoAccess.granted;
        case LocationPermission.denied:
          return GeoAccess.askable;
        case LocationPermission.deniedForever:
        case LocationPermission.unableToDetermine:
          return GeoAccess.blocked;
      }
    } catch (_) {
      return GeoAccess.blocked;
    }
  }

  @override
  Future<bool> request() async {
    try {
      final p = await Geolocator.requestPermission();
      return p == LocationPermission.always ||
          p == LocationPermission.whileInUse;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<GeoFix?> capture({
    Duration timeout = const Duration(seconds: 10),
  }) async {
    if (await access() != GeoAccess.granted) return null;
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: timeout,
        ),
      );
      return GeoFix(
        lat: p.latitude,
        lng: p.longitude,
        accuracyM: p.accuracy,
        capturedAt: p.timestamp,
        isMocked: p.isMocked,
      );
    } on TimeoutException {
      return null;
    } catch (_) {
      // No fix (no signal, service turned off meanwhile): send without one.
      return null;
    }
  }

  @override
  Future<void> openSettings() => Geolocator.openAppSettings();
}
