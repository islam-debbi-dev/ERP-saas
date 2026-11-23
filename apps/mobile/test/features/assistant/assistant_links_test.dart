import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/logic/assistant_links.dart';
import 'package:orvynt_starter/features/assistant/ui/widgets/answer_links.dart';

import '../../helpers/pump_app.dart';

const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const dash = 'https://erp.example.dz';

/// What [href] becomes for [user], as a short string for the table.
String target(String href, AuthUser user, {String dashboard = dash}) =>
    switch (AssistantLinks.resolve(href, user, dashboardUrl: dashboard)) {
      AppRouteTarget(:final path, :final inChatTab) =>
        '${inChatTab ? 'push' : 'go'} $path',
      SalePageTarget(:final saleId) => 'sale $saleId',
      OrderPageTarget(:final orderId) => 'order $orderId',
      WebTarget(:final url) => 'web $url',
      null => 'none',
    };

void main() {
  group('AssistantLinks.resolve', () {
    test('seller', () {
      final u = seller();
      expect(target('/clients/$id', u), 'go /seller/clients/$id');
      expect(target('/ventes/$id', u), 'sale $id');
      expect(target('/commandes/$id', u), 'order $id');
      expect(target('/versements', u), 'push /seller/more/payments');
      expect(target('/stock/$id', u), 'web $dash/stock/$id');
      expect(target('/clients/a-relancer', u), 'web $dash/clients/a-relancer');
      expect(target('/rapports', u), 'web $dash/rapports');
      expect(target('/achats/$id', u), 'web $dash/achats/$id');
    });

    test('seller without TOURNEES or PAYMENTS_CREATE: the dashboard', () {
      final u = seller(
        permissions: const [Permission.salesCreate],
        features: const [Feature.mobileApp],
      );
      expect(target('/commandes/$id', u), 'web $dash/commandes/$id');
      expect(target('/versements', u), 'web $dash/versements');
    });

    test('livreur', () {
      final u = livreur();
      expect(target('/clients/$id', u), 'go /livreur/clients/$id');
      expect(target('/ventes/$id', u), 'sale $id');
      expect(target('/commandes/$id', u), 'go /livreur/deliveries/$id');
      // VIEW_ALL only: no versements screen of his own.
      expect(target('/versements', u), 'web $dash/versements');
      expect(
        target(
          '/versements',
          livreur(permissions: const [Permission.paymentsCreate]),
        ),
        'push /livreur/more/payments',
      );
    });

    test('supervisor and storekeeper: every link on the dashboard', () {
      for (final u in [supervisor(), storekeeper()]) {
        for (final href in [
          '/clients/$id',
          '/ventes/$id',
          '/commandes/$id',
          '/versements',
          '/stock/$id',
        ]) {
          expect(target(href, u), 'web $dash$href');
        }
      }
    });

    test('query and hash are kept for the dashboard, ignored for the app', () {
      expect(
        target('/clients/$id?tab=releve', seller()),
        'go /seller/clients/$id',
      );
      expect(target('/stock?q=eau#top', seller()), 'web $dash/stock?q=eau#top');
    });

    test('a non-id segment is not taken for an id', () {
      expect(target('/clients/nouveau', seller()), 'web $dash/clients/nouveau');
      expect(target('/ventes/nouvelle', seller()), 'web $dash/ventes/nouvelle');
    });

    test('no dashboard configured: web links are dropped', () {
      expect(target('/stock/$id', seller(), dashboard: ''), 'none');
      expect(
        target('/clients/$id', seller(), dashboard: ''),
        'go /seller/clients/$id',
      );
    });

    test('never an outside site', () {
      for (final href in [
        'https://evil.example',
        '//evil.example/x',
        'javascript:alert(1)',
        'clients/$id',
        '',
      ]) {
        expect(target(href, seller()), 'none', reason: href);
      }
    });
  });

  group('AnswerLinks', () {
    for (final locale in ['ar', 'fr']) {
      testWidgets('chips for app screens and the dashboard in $locale', (
        tester,
      ) async {
        final opened = <Uri>[];
        await pumpScreen(
          tester,
          Scaffold(
            body: AnswerLinks(
              dashboardUrl: dash,
              openUrl: (url) async {
                opened.add(url);
                return true;
              },
              links: const [
                AssistantLink(
                  label: 'Superette El Baraka',
                  href: '/clients/$id',
                ),
                AssistantLink(
                  label: 'مياه معدنية 1,5 لتر بالكرطونة الكبيرة',
                  href: '/stock/$id',
                ),
                AssistantLink(label: 'Evil', href: 'https://evil.example'),
              ],
            ),
          ),
          locale: locale,
          user: seller(),
        );
        expect(find.byType(ActionChip), findsNWidgets(2));
        expect(find.text('Evil'), findsNothing);
        expect(find.byIcon(Icons.open_in_new), findsOneWidget);
        expectNoOverflow(tester);

        await tester.tap(find.byIcon(Icons.open_in_new));
        await tester.pump();
        expect(opened.single.toString(), '$dash/stock/$id');
      });
    }

    testWidgets('no chip when nothing can be followed', (tester) async {
      await pumpScreen(
        tester,
        const Scaffold(
          body: AnswerLinks(
            dashboardUrl: '',
            links: [AssistantLink(label: 'Stock', href: '/stock/$id')],
          ),
        ),
        locale: 'fr',
        user: storekeeper(),
      );
      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets(
      'an app screen link shows a forward arrow, not the browser icon',
      (tester) async {
        await pumpScreen(
          tester,
          const Scaffold(
            body: AnswerLinks(
              dashboardUrl: dash,
              links: [
                AssistantLink(label: 'BL-2026-000123', href: '/ventes/$id'),
              ],
            ),
          ),
          locale: 'fr',
          user: seller(),
        );
        expect(find.byIcon(Icons.arrow_forward), findsOneWidget);
        expect(find.byIcon(Icons.open_in_new), findsNothing);
      },
    );
  });
}
