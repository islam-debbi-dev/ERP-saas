import 'package:decimal/decimal.dart';

import '../../../core/geo/geo_fix.dart';
import '../../../core/helpers/money.dart';
import '../../clients/data/models/client.dart';
import '../../sales/logic/basket.dart';

/// What a versement form holds, and its rules (the API checks them again):
/// a positive amount; a cheque has its number, bank and due date; each
/// allocation is positive and within the document's remaining amount; the
/// allocations add up to at most the amount.
class VersementForm {
  const VersementForm({
    this.amount,
    this.mode = PaymentModeValue.especes,
    this.reference = '',
    this.bank = '',
    this.dueDate,
    this.note = '',
    this.allocations = const {},
  });

  final Decimal? amount;
  final PaymentModeValue mode;
  final String reference;
  final String bank;

  /// Cheque échéance, `YYYY-MM-DD`.
  final String? dueDate;
  final String note;

  /// saleId → amount given to that document (optional: none = automatic,
  /// oldest unpaid document first).
  final Map<String, Decimal> allocations;

  Decimal get allocated => Money.sum(allocations.values);

  VersementForm copyWith({
    Decimal? amount,
    bool clearAmount = false,
    PaymentModeValue? mode,
    String? reference,
    String? bank,
    String? dueDate,
    String? note,
    Map<String, Decimal>? allocations,
  }) => VersementForm(
    amount: clearAmount ? null : (amount ?? this.amount),
    mode: mode ?? this.mode,
    reference: reference ?? this.reference,
    bank: bank ?? this.bank,
    dueDate: dueDate ?? this.dueDate,
    note: note ?? this.note,
    allocations: allocations ?? this.allocations,
  );

  /// The i18n keys of what is wrong; empty = ready to send.
  List<String> errors(List<UnpaidDocument> unpaid) {
    final out = <String>[];
    final a = amount;
    if (a == null || a <= Decimal.zero) out.add('versement.error_amount');
    if (a != null && Money.round2(a) != a) out.add('versement.error_amount');
    if (mode == PaymentModeValue.cheque) {
      if (reference.trim().isEmpty) out.add('versement.error_cheque_number');
      if (bank.trim().isEmpty) out.add('versement.error_bank');
      if (dueDate == null) out.add('versement.error_due_date');
    }
    final remaining = {for (final d in unpaid) d.saleId: d.remaining};
    for (final e in allocations.entries) {
      final max = remaining[e.key];
      if (e.value <= Decimal.zero || max == null || e.value > max) {
        out.add('versement.error_allocation');
        break;
      }
    }
    if (a != null && allocated > a) out.add('versement.error_allocated_sum');
    return out.toSet().toList();
  }

  /// The `createPaymentSchema` body.
  Map<String, dynamic> toJson({
    required String clientId,
    required GeoFix? geo,
    String? geoNote,
  }) => {
    'clientId': clientId,
    'amount': Money.toApi(amount!),
    'mode': mode.api,
    'reference': reference.trim(),
    'bank': mode == PaymentModeValue.cheque ? bank.trim() : '',
    'dueDate': mode == PaymentModeValue.cheque ? dueDate : null,
    'note': note.trim(),
    if (allocations.isNotEmpty)
      'allocations': [
        for (final e in allocations.entries)
          {'saleId': e.key, 'amount': Money.toApi(e.value)},
      ],
    'geo': geoInputJson(geo, note: geoNote),
  };
}
