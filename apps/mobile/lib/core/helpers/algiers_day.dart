/// Algiers time is UTC+1 all year (no daylight saving). Document dates and
/// "today" follow the Algiers day, like the API (`algiersDay` in shared).
class AlgiersDay {
  AlgiersDay._();

  static const offset = Duration(hours: 1);

  /// The Algiers calendar day of [instant] (now by default), `YYYY-MM-DD`.
  static String of([DateTime? instant]) {
    final t = (instant ?? DateTime.now()).toUtc().add(offset);
    return _fmt(t.year, t.month, t.day);
  }

  /// [days] before the Algiers day of [instant].
  static String minusDays(int days, [DateTime? instant]) =>
      of((instant ?? DateTime.now()).subtract(Duration(days: days)));

  /// `22/11/2026` for display.
  static String display(String isoDay) {
    final p = isoDay.split('-');
    return p.length == 3 ? '${p[2]}/${p[1]}/${p[0]}' : isoDay;
  }

  /// Local display of an API timestamp in Algiers time: `22/11/2026 14:05`.
  static String displayDateTime(DateTime instant) {
    final t = instant.toUtc().add(offset);
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(t.day)}/${two(t.month)}/${t.year} ${two(t.hour)}:${two(t.minute)}';
  }

  static String time(DateTime instant) {
    final t = instant.toUtc().add(offset);
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(t.hour)}:${two(t.minute)}';
  }

  static String _fmt(int y, int m, int d) =>
      '${y.toString().padLeft(4, '0')}-${m.toString().padLeft(2, '0')}-${d.toString().padLeft(2, '0')}';
}
