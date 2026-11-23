import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

import '../localization/tr.dart';

/// "Naviguer": directions to a client's point in the phone's maps app.
class NavigationLinks {
  NavigationLinks._();

  /// The URIs to try, in order: Google Maps turn-by-turn (Android only), the
  /// Google Maps directions link (the app when installed, else the browser),
  /// then the generic `geo:` intent any maps app answers.
  static List<Uri> uris(double lat, double lng, {TargetPlatform? platform}) {
    final p = _coord(lat, lng);
    return [
      if ((platform ?? defaultTargetPlatform) == TargetPlatform.android)
        Uri.parse('google.navigation:q=$p'),
      Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$p'),
      Uri.parse('geo:$p?q=$p'),
    ];
  }

  /// `36.752887,3.042048`: always a dot, 6 decimals (about 10 cm).
  static String _coord(double lat, double lng) =>
      '${lat.toStringAsFixed(6)},${lng.toStringAsFixed(6)}';

  /// Tests replace the launcher.
  @visibleForTesting
  static Future<bool> Function(Uri uri) launch = (uri) => url_launcher
      .launchUrl(uri, mode: url_launcher.LaunchMode.externalApplication);

  /// Opens the first URI something answers; a snackbar when none does.
  static Future<void> open(BuildContext context, double lat, double lng) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    final failed = context.tr('errors.cannot_open');
    for (final uri in uris(lat, lng)) {
      try {
        if (await launch(uri)) return;
      } catch (_) {
        // No app for this scheme: try the next one.
      }
    }
    messenger?.showSnackBar(SnackBar(content: Text(failed)));
  }
}
