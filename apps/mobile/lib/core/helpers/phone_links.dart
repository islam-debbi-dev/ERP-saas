import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/tr.dart';

/// Call and WhatsApp buttons of a client.
class PhoneLinks {
  PhoneLinks._();

  /// An Algerian number in international form for wa.me: `0550 12 34 56` →
  /// `213550123456`. Null when it is not a number.
  static String? whatsappNumber(String phone) {
    var digits = phone.replaceAll(RegExp(r'[^0-9+]'), '');
    if (digits.startsWith('+')) digits = digits.substring(1);
    if (digits.startsWith('00')) digits = digits.substring(2);
    if (digits.startsWith('0')) digits = '213${digits.substring(1)}';
    return RegExp(r'^\d{8,15}$').hasMatch(digits) ? digits : null;
  }

  static Future<void> call(BuildContext context, String phone) =>
      _open(context, Uri(scheme: 'tel', path: phone.replaceAll(' ', '')));

  static Future<void> whatsapp(BuildContext context, String phone) async {
    final n = whatsappNumber(phone);
    if (n == null) return;
    await _open(context, Uri.parse('https://wa.me/$n'));
  }

  static Future<void> _open(BuildContext context, Uri uri) async {
    final messenger = ScaffoldMessenger.of(context);
    final failed = context.tr('errors.cannot_open');
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {}
    messenger.showSnackBar(SnackBar(content: Text(failed)));
  }
}
