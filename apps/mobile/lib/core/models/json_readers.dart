import '../network/api_language.dart';

/// Small JSON coercions for the backend's few polymorphic fields.

/// An id that is either a plain string or a populated `{ id, ... }` object.
String? readId(dynamic value) {
  if (value == null) return null;
  if (value is String) return value;
  if (value is Map) return value['id']?.toString();
  return value.toString();
}

/// A localized string the backend already resolved, or a raw `{ ar, en }`
/// object it left as-is (e.g. a populated `storeId.name`, `items[].storeName`).
String readLocalized(dynamic value) {
  if (value == null) return '';
  if (value is String) return value;
  if (value is Map) {
    final preferred = value[ApiLanguage.current]?.toString().trim() ?? '';
    if (preferred.isNotEmpty) return preferred;
    return value['ar']?.toString().trim() ?? '';
  }
  return value.toString();
}

/// Optional variant of [readLocalized]: keeps `null` as `null`.
String? readLocalizedOrNull(dynamic value) =>
    value == null ? null : readLocalized(value);

DateTime? readDate(dynamic value) =>
    value is String ? DateTime.tryParse(value) : null;
