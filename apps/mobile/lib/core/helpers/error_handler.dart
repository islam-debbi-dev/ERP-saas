import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';

class GeneraleErrorHandler {
  static void handleError(
    dynamic error,
    StackTrace? stackTrace, {
    String? context,
  }) {
    debugPrint('ErrorHandler: Error in $context: $error');
    if (stackTrace != null) {
      debugPrint('ErrorHandler: Stack trace: $stackTrace');
    }

    // Log error for debugging
    if (kDebugMode) {
      debugPrint('=== ERROR REPORT ===');
      debugPrint('Context: $context');
      debugPrint('Error: $error');
      debugPrint('Stack trace: $stackTrace');
      debugPrint('===================');
    }
  }

  static void showErrorSnackBar(BuildContext context, String message) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  static void showNetworkErrorSnackBar(BuildContext context) {
    showErrorSnackBar(
      context,
      'Network error. Please check your connection and try again.',
    );
  }

  static void showLocationErrorSnackBar(BuildContext context) {
    showErrorSnackBar(
      context,
      'Location error. Please enable location services and try again.',
    );
  }

  static void showGenericErrorSnackBar(BuildContext context) {
    showErrorSnackBar(context, 'Something went wrong. Please try again.');
  }

  static bool isNetworkError(dynamic error) {
    return error.toString().toLowerCase().contains('network') ||
        error.toString().toLowerCase().contains('connection') ||
        error.toString().toLowerCase().contains('timeout');
  }

  static bool isLocationError(dynamic error) {
    return error.toString().toLowerCase().contains('location') ||
        error.toString().toLowerCase().contains('permission') ||
        error.toString().toLowerCase().contains('geolocator');
  }
}
