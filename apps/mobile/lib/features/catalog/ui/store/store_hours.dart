import '../../data/models/store.dart';

/// Backend `day`: 0 = Sunday … 6 = Saturday.
int backendDay(DateTime date) => date.weekday % 7;

/// Today's opening hours, or `null` when none are set for today.
OpeningHour? todayHours(Store store, DateTime now) =>
    store.openingHours.where((h) => h.day == backendDay(now)).firstOrNull;

/// When a closed store opens next, from its weekly hours.
class NextOpening {
  const NextOpening({
    required this.daysFromNow,
    required this.day,
    required this.time,
  });

  /// 0 = later today, 1 = tomorrow…
  final int daysFromNow;

  /// Backend day (0 = Sunday).
  final int day;

  /// `HH:mm`.
  final String time;
}

/// The next opening time after [now] (later today, then the next 7 days),
/// or `null` when the store has no hours.
NextOpening? nextOpening(Store store, DateTime now) {
  if (store.openingHours.isEmpty) return null;
  final nowHm =
      '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
  for (var offset = 0; offset <= 7; offset++) {
    final day = (backendDay(now) + offset) % 7;
    final hours = store.openingHours.where((h) => h.day == day).firstOrNull;
    if (hours == null) continue;
    if (offset == 0 && hours.open.compareTo(nowHm) <= 0) continue;
    return NextOpening(daysFromNow: offset, day: day, time: hours.open);
  }
  return null;
}
