import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Flattens nested JSON into dotted keys (`auth.sign_in`), like
/// AppLocalizations does at runtime.
Map<String, String> flatten(Map<String, dynamic> json, [String prefix = '']) {
  final out = <String, String>{};
  json.forEach((key, value) {
    if (value is Map<String, dynamic>) {
      out.addAll(flatten(value, '$prefix$key.'));
    } else {
      out['$prefix$key'] = value.toString();
    }
  });
  return out;
}

Map<String, String> load(String lang) => flatten(
  jsonDecode(File('lib/core/localization/$lang.json').readAsStringSync())
      as Map<String, dynamic>,
);

void main() {
  const langs = ['ar', 'fr', 'en'];
  final files = {for (final l in langs) l: load(l)};

  test('ar, fr and en have exactly the same keys', () {
    final ar = files['ar']!.keys.toSet();
    for (final lang in ['fr', 'en']) {
      final other = files[lang]!.keys.toSet();
      expect(
        ar.difference(other),
        isEmpty,
        reason: 'keys in ar.json missing from $lang.json',
      );
      expect(
        other.difference(ar),
        isEmpty,
        reason: 'keys in $lang.json missing from ar.json',
      );
    }
  });

  test('no empty string', () {
    for (final lang in langs) {
      final empty = files[lang]!.entries
          .where((e) => e.value.trim().isEmpty)
          .map((e) => e.key);
      expect(empty, isEmpty, reason: 'empty strings in $lang.json');
    }
  });

  test('placeholders match across languages', () {
    final placeholder = RegExp(r'\{(\w+)\}');
    Set<String> names(String s) =>
        placeholder.allMatches(s).map((m) => m.group(1)!).toSet();
    for (final key in files['ar']!.keys) {
      final expected = names(files['ar']![key]!);
      for (final lang in ['fr', 'en']) {
        expect(
          names(files[lang]![key]!),
          expected,
          reason: '$key: placeholders differ in $lang.json',
        );
      }
    }
  });

  test('every literal key used in lib/ exists', () {
    final call = RegExp(
      r'''(?:\.tr|translate)\(\s*'([a-z_]+(?:\.[A-Za-z_]+)+)'\s*[,)]''',
    );
    final used = <String>{};
    for (final f in Directory('lib').listSync(recursive: true)) {
      if (f is! File || !f.path.endsWith('.dart')) continue;
      for (final m in call.allMatches(f.readAsStringSync())) {
        used.add(m.group(1)!);
      }
    }
    expect(used, isNotEmpty);
    final missing = used.difference(files['ar']!.keys.toSet());
    expect(missing, isEmpty, reason: 'keys used in code but not in ar.json');
  });

  test('every error code the app translates has a string', () {
    final source = File(
      'lib/core/network/error_messages.dart',
    ).readAsStringSync();
    final codes = RegExp(r"'([A-Z][A-Z_]+)',").allMatches(source);
    for (final m in codes) {
      expect(
        files['ar']!.containsKey('errors.${m.group(1)}'),
        isTrue,
        reason: 'errors.${m.group(1)} missing',
      );
    }
  });
}
