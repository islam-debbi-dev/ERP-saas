import 'package:decimal/decimal.dart';

import '../../orders/data/models/order.dart';

/// `DeliverOrderResultDto`: the delivered order, its BL (id, number, TTC),
/// the warnings, the change given back and the GPS check (A3).
class DeliverResult {
  const DeliverResult({
    required this.order,
    required this.saleId,
    required this.saleTotalTtc,
    required this.change,
    this.saleNumber,
    this.warnings = const [],
    this.geoStatus,
  });

  final Order order;
  final String saleId;
  final String? saleNumber;
  final Decimal saleTotalTtc;
  final Decimal change;
  final List<Map<String, dynamic>> warnings;

  /// OK / FAR / NO_SIGNAL / ... when the position was checked.
  final String? geoStatus;

  factory DeliverResult.fromJson(Map<String, dynamic> json) {
    final sale = json['sale'] as Map<String, dynamic>;
    return DeliverResult(
      order: Order.fromJson(json['order'] as Map<String, dynamic>),
      saleId: sale['id'] as String,
      saleNumber: sale['number'] as String?,
      saleTotalTtc: Decimal.parse(sale['totalTtc'] as String),
      change: Decimal.parse(json['change'] as String? ?? '0'),
      warnings: [
        for (final w in json['warnings'] as List<dynamic>? ?? const [])
          w as Map<String, dynamic>,
      ],
      geoStatus:
          (json['geoCheck'] as Map<String, dynamic>?)?['status'] as String?,
    );
  }
}
