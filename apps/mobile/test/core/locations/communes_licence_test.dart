import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/locations/communes_licence.dart';

/// The header comment of `communes.ts`, without the comment stars.
List<String> sharedHeader() {
  final source = File(
    '../../packages/shared/src/communes.ts',
  ).readAsStringSync();
  return source
      .substring(0, source.indexOf('*/'))
      .split('\n')
      .map((line) => line.replaceFirst(RegExp(r'^\s*/?\*+'), '').trim())
      .toList();
}

String words(String text) => text.split(RegExp(r'\s+')).join(' ').trim();

void main() {
  test('the notice and source are the ones in communes.ts', () {
    final header = sharedHeader();
    final from = header.indexOf('MIT License');
    final to = header.indexOf('SOFTWARE.', from);
    expect(from, isNonNegative);
    expect(to, greaterThan(from));
    expect(communesLicenceNotice.split('\n'), header.sublist(from, to + 1));
    for (final line in communesLicenceSource.split('\n')) {
      expect(header, contains(line));
    }
  });

  test('the registry holds the whole entry once registered', () async {
    LicenseRegistry.reset();
    addTearDown(LicenseRegistry.reset);
    registerCommunesLicence();
    final entry = (await LicenseRegistry.licenses.toList()).single;
    expect(entry.packages, [communesLicencePackage]);
    expect(
      words(entry.paragraphs.map((p) => p.text).join(' ')),
      words('$communesLicenceSource $communesLicenceNotice'),
    );
  });

  test('the app registers it at startup', () {
    expect(
      File('lib/main.dart').readAsStringSync(),
      contains('registerCommunesLicence();'),
    );
  });
}
