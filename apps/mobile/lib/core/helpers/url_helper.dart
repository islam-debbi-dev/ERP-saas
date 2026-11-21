import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

import '../localization/app_localizations.dart';

class UrlHelper {
  static Future<void> launchUrl(BuildContext context, String url) async {
    if (url.isEmpty) return;

    // if url for email
    if (url.contains('@')) {
      if (!await url_launcher.launchUrl(
        Uri.parse('mailto:$url'),
        mode: url_launcher.LaunchMode.externalApplication,
      )) {
        throw 'Could not launch $url';
      }
      return;
    }

    // Ensure the URL has a scheme.
    String wellFormedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      wellFormedUrl = 'https://$url';
    }

    final Uri uri = Uri.parse(wellFormedUrl);
    debugPrint('Launching URL: $uri');

    try {
      if (!await url_launcher.launchUrl(
        uri,
        mode: url_launcher.LaunchMode.externalApplication,
      )) {
        throw 'Could not launch $uri';
      }
    } catch (e) {
      debugPrint('Error launching URL: $e');
      if (!context.mounted) return;
      final localizations = AppLocalizations.of(context);
      final errorMessage =
          localizations?.translate('error_unknown') ??
          'An unknown error occurred';
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(errorMessage)));
    }
  }
}
