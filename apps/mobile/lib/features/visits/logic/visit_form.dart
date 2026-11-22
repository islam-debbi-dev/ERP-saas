/// VISIT_OUTCOMES and NO_SALE_REASONS of `packages/shared/src/enums.ts`.
class VisitOutcome {
  VisitOutcome._();
  static const sale = 'SALE';
  static const order = 'ORDER';
  static const paymentOnly = 'PAYMENT_ONLY';
  static const noSale = 'NO_SALE';
  static const all = [sale, order, paymentOnly, noSale];
}

class NoSaleReason {
  NoSaleReason._();
  static const other = 'OTHER';
  static const all = ['CLOSED', 'HAS_STOCK', 'NO_MONEY', 'REFUSED', other];
}

/// The documents made for the client during this visit (the latest of each).
class VisitDocs {
  const VisitDocs({this.saleId, this.orderId, this.paymentId});

  final String? saleId;
  final String? orderId;
  final String? paymentId;

  VisitDocs merge({String? saleId, String? orderId, String? paymentId}) =>
      VisitDocs(
        saleId: saleId ?? this.saleId,
        orderId: orderId ?? this.orderId,
        paymentId: paymentId ?? this.paymentId,
      );

  /// The outcome a visit with these documents most likely had.
  String get suggestedOutcome => saleId != null
      ? VisitOutcome.sale
      : orderId != null
      ? VisitOutcome.order
      : paymentId != null
      ? VisitOutcome.paymentOnly
      : VisitOutcome.noSale;

  /// Whether [outcome] has the document it must point to.
  bool allows(String outcome) => switch (outcome) {
    VisitOutcome.sale => saleId != null,
    VisitOutcome.order => orderId != null,
    VisitOutcome.paymentOnly => paymentId != null,
    _ => true,
  };
}

/// Where a visit starts: a stop of today's route, or a client opened from
/// the list (no route).
class VisitStart {
  const VisitStart({
    required this.startedAt,
    this.routeId,
    this.docs = const VisitDocs(),
  });

  final DateTime startedAt;
  final String? routeId;

  /// The caller's documents for this client today (from `/me/today`).
  final VisitDocs docs;
}

/// The visit form and its rules (`createVisitSchema`): NO_SALE needs a
/// reason, OTHER needs a note; SALE / ORDER / PAYMENT_ONLY point to their
/// document.
class VisitForm {
  const VisitForm({
    required this.clientId,
    required this.start,
    required this.docs,
    required this.outcome,
    this.reason,
    this.note = '',
  });

  final String clientId;
  final VisitStart start;
  final VisitDocs docs;
  final String outcome;
  final String? reason;
  final String note;

  VisitForm copyWith({String? outcome, String? reason, String? note}) =>
      VisitForm(
        clientId: clientId,
        start: start,
        docs: docs,
        outcome: outcome ?? this.outcome,
        reason: outcome != null && outcome != VisitOutcome.noSale
            ? null
            : (reason ?? this.reason),
        note: note ?? this.note,
      );

  /// The i18n keys of what is missing; empty = ready.
  List<String> get errors {
    final out = <String>[];
    if (outcome == VisitOutcome.noSale) {
      if (reason == null) out.add('visit.error_reason');
      if (reason == NoSaleReason.other && note.trim().isEmpty) {
        out.add('visit.error_note');
      }
    } else if (!docs.allows(outcome)) {
      out.add('visit.error_document');
    }
    return out;
  }

  Map<String, dynamic> toJson({
    required DateTime endedAt,
    required Map<String, dynamic> geo,
  }) {
    final ended = endedAt.isBefore(start.startedAt) ? start.startedAt : endedAt;
    return {
      'clientId': clientId,
      'routeId': start.routeId,
      'startedAt': start.startedAt.toUtc().toIso8601String(),
      'endedAt': ended.toUtc().toIso8601String(),
      'outcome': outcome,
      'reason': outcome == VisitOutcome.noSale ? reason : null,
      'note': note.trim(),
      'saleId': outcome == VisitOutcome.sale ? docs.saleId : null,
      'orderId': outcome == VisitOutcome.order ? docs.orderId : null,
      'paymentId': outcome == VisitOutcome.paymentOnly ? docs.paymentId : null,
      'geo': geo,
    };
  }
}
