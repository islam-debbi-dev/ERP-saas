import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/locations/algeria_locations.dart';
import 'package:orvynt_starter/core/locations/location_search.dart';
import 'package:orvynt_starter/core/locations/wilayas.dart';

/// `flutter test` runs from `apps/mobile`.
const shared = '../../packages/shared/src';

void main() {
  group('copies of packages/shared', () {
    test('the communes asset is a byte copy (see algeria_locations.dart)', () {
      expect(
        File(AlgeriaLocations.asset).readAsBytesSync(),
        File('$shared/communes.data.json').readAsBytesSync(),
        reason:
            'refresh: cp $shared/communes.data.json ${AlgeriaLocations.asset}',
      );
    });

    test('the wilaya names equal wilayas.ts', () {
      final row = RegExp(
        r'''\{ code: (\d+), fr: (?:'([^']*)'|"([^"]*)"), ar: '([^']*)' \}''',
      );
      final expected = [
        for (final m in row.allMatches(
          File('$shared/wilayas.ts').readAsStringSync(),
        ))
          '${m[1]}|${m[2] ?? m[3]}|${m[4]}',
      ];
      expect(expected, hasLength(69));
      expect([
        for (final w in algeriaWilayas) '${w.code}|${w.fr}|${w.ar}',
      ], expected);
    });

    test('the review gate equals COMMUNES_59_69_REVIEWED', () {
      final match = RegExp(
        r'export const COMMUNES_59_69_REVIEWED(?:: boolean)? = (true|false);',
      ).firstMatch(File('$shared/communes.ts').readAsStringSync());
      expect(match, isNotNull);
      expect(communes5969Reviewed, match![1] == 'true');
    });
  });

  test('the gate is open since the owner approved the review file', () {
    expect(communes5969Reviewed, isTrue);
    expect([59, 69].map(isWilayaUnderReview), [false, false]);
  });

  test('the gate covers wilayas 59 to 69 only, until reviewed', () {
    expect([58, 59, 69].map((w) => isWilayaUnderReview(w, reviewed: false)), [
      false,
      true,
      true,
    ]);
    expect(isWilayaUnderReview(59, reviewed: true), isFalse);
  });

  group('parsed data', () {
    late final AlgeriaLocations data = AlgeriaLocations.parse(
      File(AlgeriaLocations.asset).readAsStringSync(),
    );

    test('no row is dropped', () {
      expect(data.communes, hasLength(1541));
      expect(data.dairas, hasLength(558));
    });

    test('Rouissat has no daïra and stays in its wilaya list', () {
      final rouissat = data.communesOf(30).singleWhere((c) => c.code == 3005);
      expect(rouissat.dairaKey, isNull);
    });

    test('a daïra without an Arabic name shows the French one', () {
      final daira = data.dairas.singleWhere((d) => d.key == '58-mansoura');
      expect(daira.name('ar'), 'Mansoura');
    });
  });

  group('search', () {
    test('French: accents, case, spaces and hyphens do not count', () {
      expect(matchesSearch('bejaia', ['Béjaïa']), isTrue);
      expect(matchesSearch('AIN-DEF', ['Aïn Defla']), isTrue);
      expect(matchesSearch('msila', ["M'Sila"]), isTrue);
      expect(matchesSearch('oran', ['Alger']), isFalse);
    });

    test('Arabic: hamza, teh marbuta, maksura and diacritics', () {
      expect(matchesSearch('الاغواط', ['الأغواط']), isTrue);
      expect(matchesSearch('المسيله', ['المسيلة']), isTrue);
      expect(matchesSearch('تيزى', ['تيزي وزو']), isTrue);
      expect(matchesSearch('وَهْرَان', ['وهران']), isTrue);
      expect(matchesSearch('وهران', ['الجزائر']), isFalse);
    });

    test('a blank query matches everything; a null name matches nothing', () {
      expect(matchesSearch('  ', [null]), isTrue);
      expect(matchesSearch('a', [null]), isFalse);
    });
  });
}
