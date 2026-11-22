import 'package:decimal/decimal.dart';

import '../../../core/helpers/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_result.dart';

/// `GET /me/objectives` (`MyObjectivesDto` in
/// `packages/shared/src/schemas/incentives.ts`), live from the API.
class MyObjectives {
  const MyObjectives({
    required this.period,
    required this.daysLeft,
    required this.items,
    required this.loadedAt,
  });

  final String period;
  final int daysLeft;
  final List<Objective> items;

  /// When the phone read it ("dernière mise à jour"): the API computes it live.
  final DateTime loadedAt;

  factory MyObjectives.fromJson(Map<String, dynamic> json, DateTime loadedAt) =>
      MyObjectives(
        period: json['period'] as String,
        daysLeft: json['daysLeft'] as int,
        items: [
          for (final i in json['items'] as List<dynamic>)
            Objective.fromJson(i as Map<String, dynamic>),
        ],
        loadedAt: loadedAt,
      );
}

class Objective {
  const Objective({
    required this.targetId,
    required this.metric,
    required this.team,
    required this.subjectName,
    this.scopeLabel,
    this.achieved,
    this.target,
    this.pct,
    this.nextRemaining,
  });

  final String targetId;
  final String metric;
  final String? scopeLabel;
  final bool team;
  final String subjectName;

  /// Null when the API hides them (margin without VIEW_COST_AND_MARGIN).
  final Decimal? achieved;
  final Decimal? target;
  final Decimal? pct;
  final Decimal? nextRemaining;

  static const moneyMetrics = {'CA_HT', 'ENCAISSEMENT', 'MARGE'};
  static const percentMetrics = {'STRIKE_RATE', 'RECOUVREMENT_PCT'};

  /// The value as the metric reads: `12 500,00 DA`, `48`, `62,5 %`.
  static String formatValue(String metric, Decimal value) {
    if (moneyMetrics.contains(metric)) return Money.format(value);
    if (percentMetrics.contains(metric)) return '${Qty.format(value)} %';
    return Qty.format(value);
  }

  /// The bar's fill, 0..1 (display only).
  static double progress(Decimal? pct) {
    if (pct == null || pct <= Decimal.zero) return 0;
    final hundred = Decimal.fromInt(100);
    if (pct >= hundred) return 1;
    return (pct / hundred).toDouble();
  }

  factory Objective.fromJson(Map<String, dynamic> json) {
    Decimal? d(Object? v) => v == null ? null : Decimal.parse(v as String);
    final next = json['next'] as Map<String, dynamic>?;
    return Objective(
      targetId: json['targetId'] as String,
      metric: json['metric'] as String,
      scopeLabel: json['scopeLabel'] as String?,
      team: json['team'] as bool? ?? false,
      subjectName:
          (json['subject'] as Map<String, dynamic>)['fullName'] as String,
      achieved: d(json['achieved']),
      target: d(json['target']),
      pct: d(json['pct']),
      nextRemaining: next == null ? null : d(next['remaining']),
    );
  }
}

class ObjectivesRepository {
  ObjectivesRepository(this._api, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final ApiClient _api;
  final DateTime Function() _clock;

  Future<ApiResult<MyObjectives>> mine() => _api.get(
    '/me/objectives',
    decode: (json) => MyObjectives.fromJson(json.asMap, _clock()),
  );
}
