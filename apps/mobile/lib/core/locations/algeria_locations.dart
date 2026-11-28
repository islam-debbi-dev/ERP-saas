/// The communes and dairas of Algeria for the pickers (phase 40a).
///
/// `assets/data/communes.data.json` is a byte copy of
/// `packages/shared/src/communes.data.json`; a test fails when they differ.
/// Never edit it by hand. To refresh it, from `apps/mobile`:
///
///     cp ../../packages/shared/src/communes.data.json assets/data/
///
/// Data source: https://github.com/syscli/algeria, commit
/// 7789ea926e7c0751f33775ecf558fa026e2ee81b, MIT licence, Copyright (c) 2026
/// syscli. The full notice ships in the app: `communes_licence.dart`.
/// Dairas follow decree 91-306 of 1991 and may have changed since.
library;

import 'dart:convert';

import 'package:flutter/services.dart';

/// The owner has not yet approved `docs/review/communes-59-69.md`. While
/// false, the communes of wilayas 59 to 69 cannot be picked; the wilaya alone
/// can. Same value as `COMMUNES_59_69_REVIEWED` in
/// `packages/shared/src/communes.ts` (a test compares them).
const bool communes5969Reviewed = false;

bool isWilayaUnderReview(
  int wilayaCode, {
  bool reviewed = communes5969Reviewed,
}) => !reviewed && wilayaCode >= 59 && wilayaCode <= 69;

class Commune {
  const Commune({
    required this.code,
    required this.wilayaCode,
    required this.fr,
    required this.ar,
    this.dairaKey,
    this.aliases = const [],
  });

  /// The ONS code (`0101` is 101).
  final int code;
  final int wilayaCode;
  final String fr;
  final String ar;

  /// Null for a commune whose daira is not known (Rouissat).
  final String? dairaKey;
  final List<String> aliases;

  String name(String languageCode) => languageCode == 'ar' ? ar : fr;
}

class Daira {
  const Daira({
    required this.key,
    required this.wilayaCode,
    required this.fr,
    this.ar,
  });

  final String key;
  final int wilayaCode;
  final String fr;

  /// Null when the Arabic name is not known: [name] shows the French one.
  final String? ar;

  String name(String languageCode) => languageCode == 'ar' ? ar ?? fr : fr;
}

class AlgeriaLocations {
  AlgeriaLocations._(this.communes, this.dairas);

  static const asset = 'assets/data/communes.data.json';
  static AlgeriaLocations? _loaded;

  final List<Commune> communes;
  final List<Daira> dairas;

  /// Reads the asset the first time a picker needs it. The parsed value is
  /// kept, not the Future, so a failed load can be tried again.
  static Future<AlgeriaLocations> load() async => _loaded ??=
      AlgeriaLocations.parse(await rootBundle.loadString(asset, cache: false));

  /// The rows are arrays: `[key, wilaya, fr, ar]` for a daira,
  /// `[code, wilaya, formerWilayas, fr, ar, dairaKey, aliases]` for a commune.
  factory AlgeriaLocations.parse(String source) {
    final json = jsonDecode(source) as Map<String, dynamic>;
    return AlgeriaLocations._(
      [
        for (final row in json['communes'] as List<dynamic>)
          if (row case [
            final int code,
            final int wilaya,
            List<dynamic> _,
            final String fr,
            final String ar,
            final String? daira,
            final List<dynamic> aliases,
          ])
            Commune(
              code: code,
              wilayaCode: wilaya,
              fr: fr,
              ar: ar,
              dairaKey: daira,
              aliases: aliases.cast<String>(),
            ),
      ],
      [
        for (final row in json['dairas'] as List<dynamic>)
          if (row case [
            final String key,
            final int wilaya,
            final String fr,
            final String? ar,
          ])
            Daira(key: key, wilayaCode: wilaya, fr: fr, ar: ar),
      ],
    );
  }

  List<Daira> dairasOf(int wilayaCode) => [
    for (final d in dairas)
      if (d.wilayaCode == wilayaCode) d,
  ];

  /// The communes of a wilaya, or only those of [dairaKey] when given.
  List<Commune> communesOf(int wilayaCode, {String? dairaKey}) => [
    for (final c in communes)
      if (c.wilayaCode == wilayaCode &&
          (dairaKey == null || c.dairaKey == dairaKey))
        c,
  ];
}
