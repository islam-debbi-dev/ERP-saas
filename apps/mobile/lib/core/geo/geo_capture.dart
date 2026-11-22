import 'package:flutter/widgets.dart';

import '../../features/geo/ui/location_permission_sheet.dart';
import '../di/dependency_injection.dart';
import 'geo_fix.dart';
import 'geo_service.dart';

/// Reads the position for an operation, explaining the permission first when
/// the system has not granted it yet. Null = send without a position.
Future<GeoFix?> captureGeo(BuildContext context) async {
  final geo = getIt<GeoService>();
  final access = await geo.access();
  if (access != GeoAccess.granted) {
    if (!context.mounted) return null;
    final blocked = access == GeoAccess.blocked;
    final ok = await showLocationPermissionSheet(context, blocked: blocked);
    if (!ok) return null;
    if (blocked) {
      await geo.openSettings();
      return null;
    }
    if (!await geo.request()) return null;
  }
  return geo.capture();
}
