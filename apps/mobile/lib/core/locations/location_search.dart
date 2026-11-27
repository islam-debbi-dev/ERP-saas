/// Picker search for place names typed in French or Arabic.
library;

const _latin = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'ç': 'c', 'è': 'e',
  'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ù': 'u',
  'ú': 'u', 'û': 'u', 'ü': 'u', 'ÿ': 'y', 'œ': 'oe', //
};

const _arabic = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و', 'ئ': 'ي', 'ى': 'ي',
  'ی': 'ي', 'ة': 'ه', 'ک': 'ك', //
};

/// Marks (Latin accents typed apart, Arabic diacritics and hamza), tatweel,
/// spaces and punctuation: none of them counts in a search.
final _ignored = RegExp(r'''[̀-ًͯ-ٰٟـ\s\-_.,'"`()/’‘ʹ-ʿˈ]''');

/// The form two spellings of one name share. The same idea as `exactKey` in
/// `packages/shared/src/communes.ts`. It only filters a list the user picks
/// from; the API matches free text itself.
String searchKey(String text) {
  final out = StringBuffer();
  for (final char in text.toLowerCase().replaceAll(_ignored, '').split('')) {
    out.write(_latin[char] ?? _arabic[char] ?? char);
  }
  return out.toString();
}

/// True when one of [names] contains [query]. A blank query matches all.
bool matchesSearch(String query, Iterable<String?> names) {
  final wanted = searchKey(query);
  return wanted.isEmpty ||
      names.any((n) => n != null && searchKey(n).contains(wanted));
}
