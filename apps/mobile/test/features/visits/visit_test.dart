import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/geo/geo_fix.dart';
import 'package:orvynt_starter/features/visits/logic/visit_form.dart';
import 'package:orvynt_starter/features/visits/ui/visit_sheet.dart';

import '../../helpers/pump_app.dart';

final start = VisitStart(
  startedAt: DateTime.utc(2026, 11, 22, 9),
  routeId: 'r1',
);

VisitForm form(
  String outcome, {
  VisitDocs docs = const VisitDocs(),
  String? reason,
  String note = '',
}) => VisitForm(
  clientId: 'c1',
  start: start,
  docs: docs,
  outcome: outcome,
  reason: reason,
  note: note,
);

void main() {
  group('rules', () {
    test('NO_SALE needs a reason; OTHER needs a note', () {
      expect(form(VisitOutcome.noSale).errors, ['visit.error_reason']);
      expect(form(VisitOutcome.noSale, reason: 'CLOSED').errors, isEmpty);
      expect(form(VisitOutcome.noSale, reason: NoSaleReason.other).errors, [
        'visit.error_note',
      ]);
      expect(
        form(
          VisitOutcome.noSale,
          reason: NoSaleReason.other,
          note: 'Gérant absent',
        ).errors,
        isEmpty,
      );
    });

    test('SALE, ORDER and PAYMENT_ONLY need their document', () {
      expect(form(VisitOutcome.sale).errors, ['visit.error_document']);
      expect(
        form(VisitOutcome.sale, docs: const VisitDocs(saleId: 's1')).errors,
        isEmpty,
      );
      expect(
        form(VisitOutcome.order, docs: const VisitDocs(saleId: 's1')).errors,
        ['visit.error_document'],
      );
      expect(
        form(
          VisitOutcome.paymentOnly,
          docs: const VisitDocs(paymentId: 'p1'),
        ).errors,
        isEmpty,
      );
    });

    test('the outcome follows the documents made', () {
      expect(const VisitDocs().suggestedOutcome, VisitOutcome.noSale);
      expect(
        const VisitDocs(paymentId: 'p').suggestedOutcome,
        VisitOutcome.paymentOnly,
      );
      expect(
        const VisitDocs(orderId: 'o', paymentId: 'p').suggestedOutcome,
        VisitOutcome.order,
      );
      expect(
        const VisitDocs(saleId: 's', orderId: 'o').suggestedOutcome,
        VisitOutcome.sale,
      );
      expect(const VisitDocs(saleId: 's').merge(paymentId: 'p').paymentId, 'p');
    });

    test('choosing a sold outcome drops the no-sale reason', () {
      final f = form(
        VisitOutcome.noSale,
        docs: const VisitDocs(saleId: 's1'),
        reason: 'CLOSED',
      ).copyWith(outcome: VisitOutcome.sale);
      expect(f.reason, isNull);
    });
  });

  test('the body follows createVisitSchema', () {
    final docs = const VisitDocs(saleId: 's1', paymentId: 'p1');
    final body = form(VisitOutcome.sale, docs: docs).toJson(
      endedAt: DateTime.utc(2026, 11, 22, 9, 12),
      geo: geoInputJson(
        GeoFix(
          lat: 36.7,
          lng: 3.1,
          accuracyM: 9,
          capturedAt: DateTime.utc(2026, 11, 22, 9, 12),
        ),
      ),
    );
    expect(body['clientId'], 'c1');
    expect(body['routeId'], 'r1');
    expect(body['startedAt'], '2026-11-22T09:00:00.000Z');
    expect(body['endedAt'], '2026-11-22T09:12:00.000Z');
    expect(body['outcome'], 'SALE');
    expect(body['saleId'], 's1');
    expect(body['paymentId'], isNull);
    expect(body['reason'], isNull);

    final noSale = form(
      VisitOutcome.noSale,
      reason: 'OTHER',
      note: ' Fermé pour deuil ',
    ).toJson(endedAt: DateTime.utc(2026, 11, 22, 8), geo: geoInputJson(null));
    expect(noSale['reason'], 'OTHER');
    expect(noSale['note'], 'Fermé pour deuil');
    // A device clock behind the start never sends an end before the start.
    expect(noSale['endedAt'], '2026-11-22T09:00:00.000Z');
  });

  for (final locale in ['ar', 'fr']) {
    testWidgets('visit sheet at 360 dp in $locale asks for a reason', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        Scaffold(
          body: VisitSheet(
            clientId: 'c1',
            start: start,
            docs: const VisitDocs(),
          ),
        ),
        locale: locale,
      );
      expect(find.byType(RadioListTile<String>), findsNWidgets(4));
      final save = find.text(
        locale == 'fr' ? 'Enregistrer la visite' : 'حفظ الزيارة',
      );
      await tester.ensureVisible(save);
      await tester.pumpAndSettle();
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(
        find.text(locale == 'fr' ? 'Choisissez un motif' : 'اختر السبب'),
        findsOneWidget,
      );
      expectNoOverflow(tester);
    });
  }
}
