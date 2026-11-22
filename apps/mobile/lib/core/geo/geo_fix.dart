/// One device position, read at the moment of an operation (phase 17).
/// Raw data only: the API computes the distance and the verdict.
class GeoFix {
  const GeoFix({
    required this.lat,
    required this.lng,
    required this.accuracyM,
    required this.capturedAt,
    this.isMocked = false,
  });

  final double lat;
  final double lng;
  final double accuracyM;
  final DateTime capturedAt;

  /// Android's mock-location flag.
  final bool isMocked;
}

/// The `geo` field of a sale, versement, visit or delivery
/// (`geoInputSchema` in `packages/shared/src/schemas/geo.ts`): the position is
/// all four of lat / lng / accuracyM / capturedAt or none of them; [note] is
/// added when the API answers GEO_NOTE_REQUIRED.
Map<String, dynamic> geoInputJson(GeoFix? fix, {String? note}) => {
  if (fix != null) ...{
    'lat': fix.lat,
    'lng': fix.lng,
    // The schema caps it; a phone may report more than 100 km indoors.
    'accuracyM': fix.accuracyM.clamp(0, 100000),
    'capturedAt': fix.capturedAt.toUtc().toIso8601String(),
    'isMocked': fix.isMocked,
  } else
    'isMocked': false,
  if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
};
