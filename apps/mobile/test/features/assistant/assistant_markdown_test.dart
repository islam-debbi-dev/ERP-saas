import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/helpers/money.dart';
import 'package:orvynt_starter/core/helpers/text_direction.dart';
import 'package:orvynt_starter/features/assistant/logic/assistant_markdown.dart';
import 'package:orvynt_starter/features/assistant/ui/widgets/assistant_markdown_view.dart';

import '../../helpers/pump_app.dart';

List<String> amounts(String text) => [
  for (final p in splitAmounts(text))
    if (p.amount) p.text,
];

const lri = Money.ltrIsolateStart;
const pdi = Money.ltrIsolateEnd;
const nbsp = Money.currencySpace;

void main() {
  group('AssistantMarkdown.parse', () {
    test('bold inside a paragraph', () {
      final blocks = AssistantMarkdown.parse('Le client **Ahmed** doit payer.');
      expect(blocks.single, isA<MdParagraph>());
      expect(blocks.single.spans, const [
        MdSpan('Le client '),
        MdSpan('Ahmed', bold: true),
        MdSpan(' doit payer.'),
      ]);
    });

    test('line breaks and paragraphs', () {
      final blocks = AssistantMarkdown.parse('Ligne 1\nLigne 2\n\nAutre');
      expect(blocks, hasLength(2));
      expect(blocks[0].spans.single.text, 'Ligne 1\nLigne 2');
      expect(blocks[1].spans.single.text, 'Autre');
    });

    test('bullet and numbered lists', () {
      final blocks = AssistantMarkdown.parse(
        'Les clients :\n- **Ahmed** : 12 000 DA\n* Karim\n• Samir\n\n'
        '1. Ouvrez le client\n2) Touchez Versement',
      );
      expect(blocks.map((b) => b.runtimeType).toList(), [
        MdParagraph,
        MdBullet,
        MdBullet,
        MdBullet,
        MdNumbered,
        MdNumbered,
      ]);
      expect(blocks[1].spans.first, const MdSpan('Ahmed', bold: true));
      expect((blocks[4] as MdNumbered).number, 1);
      expect((blocks[5] as MdNumbered).number, 2);
      expect(blocks[5].spans.single.text, 'Touchez Versement');
    });

    test('an unclosed ** stays literal', () {
      final blocks = AssistantMarkdown.parse('Total **12 000 DA');
      expect(blocks.single.spans, const [MdSpan('Total **12 000 DA')]);
    });

    test('a link shows its label, code its text, a heading bold', () {
      final blocks = AssistantMarkdown.parse(
        '### Résumé\nVoir [la fiche](/clients/x) et `CUMP`.',
      );
      expect(blocks[0].spans, const [MdSpan('Résumé', bold: true)]);
      expect(blocks[1].spans, const [
        MdSpan('Voir '),
        MdSpan('la fiche', link: true),
        MdSpan(' et CUMP.'),
      ]);
    });

    test('no HTML or image: literal text', () {
      final blocks = AssistantMarkdown.parse('<b>x</b> ![img](http://a/b.png)');
      expect(
        blocks.single.spans.map((s) => s.text).join(),
        '<b>x</b> !img',
        reason: 'the image becomes its alt text, never loaded',
      );
    });
  });

  group('splitAmounts (the web\'s cases)', () {
    test('finds an amount inside Arabic', () {
      expect(splitAmounts('عند كريم: 1 234 567,89 DA.'), const [
        TextPart('عند كريم: ', amount: false),
        TextPart('1 234 567,89 DA', amount: true),
        TextPart('.', amount: false),
      ]);
    });

    test('handles the spaces and currencies models use', () {
      expect(amounts('125 000 دج'), ['125 000 دج']);
      expect(amounts('1 234,50 DA'), ['1 234,50 DA']);
      expect(amounts('500 DA et 12,50'), ['500 DA', '12,50']);
      expect(amounts('1 234,50 DA'), ['1 234,50 DA']);
    });

    test('leaves everything else alone', () {
      expect(amounts('BL-2026-000123 du 2026-11-05, 3 cartons'), isEmpty);
      expect(splitAmounts('salam').map((p) => p.text).join(), 'salam');
    });

    test('never loses a character', () {
      const text = 'a 1 000 DA b 2 000,50 c';
      expect(splitAmounts(text).map((p) => p.text).join(), text);
    });

    test('isolateAmounts keeps dates in order too', () {
      expect(
        isolateAmounts('يوم 2026-11-20 و 14/09/2026 و BL-2026-000123'),
        'يوم ${lri}2026-11-20$pdi و ${lri}14/09/2026$pdi و BL-2026-000123',
      );
    });

    test('isolateAmounts wraps each amount LTR, on one line', () {
      expect(
        isolateAmounts('عليه 12 500,00 DA اليوم'),
        'عليه ${lri}12${nbsp}500,00${nbsp}DA$pdi اليوم',
      );
    });
  });

  group('textDirectionOf', () {
    test('the first strong letter decides', () {
      expect(textDirectionOf('شحال الكريدي؟'), TextDirection.rtl);
      expect(textDirectionOf('12 500 DA عليه'), TextDirection.ltr);
      expect(textDirectionOf('12 500 عليه'), TextDirection.rtl);
      expect(textDirectionOf('Combien ?'), TextDirection.ltr);
      expect(
        textDirectionOf('1234', fallback: TextDirection.rtl),
        TextDirection.rtl,
      );
    });
  });

  for (final locale in ['ar', 'fr']) {
    testWidgets('an Arabic answer is RTL with its amounts LTR in $locale', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const Scaffold(
          body: Padding(
            padding: EdgeInsets.all(16),
            child: AssistantMarkdownView(
              text:
                  'الكريدي تاع **سوبيرات البركة** هو 1 234 567,89 DA.\n'
                  '- آخر دفعة: 15 000 DA\n'
                  '- أقدم دين: 2026-09-14\n\n'
                  '1. افتح الزبون\n2. اضغط على دفعة',
            ),
          ),
        ),
        locale: locale,
      );
      final rich = tester.widgetList<RichText>(find.byType(RichText)).toList();
      final first = rich.firstWhere(
        (r) => r.text.toPlainText().contains('الكريدي'),
      );
      expect(
        Directionality.of(tester.element(find.byWidget(first))),
        TextDirection.rtl,
      );
      expect(
        first.text.toPlainText(),
        contains('${lri}1${nbsp}234${nbsp}567,89${nbsp}DA$pdi'),
      );
      expect(find.text('•'), findsNWidgets(2));
      expect(find.text('2.'), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('a French answer is LTR in $locale', (tester) async {
      await pumpScreen(
        tester,
        const Scaffold(
          body: AssistantMarkdownView(
            text: 'Ahmed doit **12 500,00 DA** depuis le 14/09.',
          ),
        ),
        locale: locale,
      );
      final rich = tester
          .widgetList<RichText>(find.byType(RichText))
          .firstWhere((r) => r.text.toPlainText().contains('Ahmed'));
      expect(
        Directionality.of(tester.element(find.byWidget(rich))),
        TextDirection.ltr,
      );
      expectNoOverflow(tester);
    });
  }
}
