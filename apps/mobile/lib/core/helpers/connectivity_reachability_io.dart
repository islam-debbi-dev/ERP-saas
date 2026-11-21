import 'dart:io';

Future<bool> connectivityProbeReachability({
  required Duration timeout,
}) async {
  try {
    final addrs = await InternetAddress.lookup(
      'google.com',
      type: InternetAddressType.any,
    ).timeout(timeout);
    return addrs.isNotEmpty;
  } catch (_) {
    return false;
  }
}
