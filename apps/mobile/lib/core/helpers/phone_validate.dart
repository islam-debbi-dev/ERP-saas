String? validatePhone(String? phone) {
  if (phone == null || phone.trim().isEmpty) {
    return 'phone_required';
  }

  final normalized = phone.trim();

  // Algerian phone pattern: 0, +213 or 00213, then 5/6/7 and 8 digits
  final regex = RegExp(r'^(00213|\+213|0)(5|6|7)[0-9]{8}$');

  if (!regex.hasMatch(normalized)) {
    return 'phone_invalid';
  }

  return null;
}
