import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_repository.dart';
import 'package:orvynt_starter/features/assistant/ui/assistant_screen.dart';
import 'package:orvynt_starter/features/assistant/ui/widgets/chat_input_bar.dart';

import '../../helpers/pump_app.dart';
import 'assistant_fakes.dart';

const available = AssistantStatus(available: true, provider: 'GEMINI');

void main() {
  late FakeAssistantRepository repo;

  setUp(() {
    repo = FakeAssistantRepository();
    getIt.registerSingleton<AssistantRepository>(repo);
  });
  tearDown(() => getIt.reset());

  Future<void> pump(WidgetTester tester, String locale) => pumpScreen(
    tester,
    const AssistantScreen(),
    locale: locale,
    user: seller(),
    assistant: available,
  );

  Future<void> ask(WidgetTester tester, String text) async {
    await tester.enterText(find.byKey(const Key('assistant-input')), text);
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pump();
  }

  for (final locale in ['ar', 'fr']) {
    testWidgets('empty chat with the seller\'s suggestions in $locale', (
      tester,
    ) async {
      await pump(tester, locale);
      expect(find.byType(OutlinedButton), findsNWidgets(3));
      expect(find.textContaining('Google Gemini'), findsOneWidget);
      // Nothing typed: send is disabled.
      final send = tester.widget<IconButton>(
        find.byKey(const Key('assistant-send')),
      );
      expect(send.onPressed, isNull);
      expectNoOverflow(tester);
    });

    testWidgets('streaming with a tool, then done and truncated in $locale', (
      tester,
    ) async {
      await pump(tester, locale);
      await ask(tester, 'شحال الكريدي تاع أحمد؟');
      expect(find.byKey(const Key('assistant-send')), findsNothing);
      expect(find.byKey(const Key('assistant-stop')), findsOneWidget);
      expect(
        find.text(locale == 'fr' ? 'Je réfléchis…' : 'أفكر…'),
        findsOneWidget,
      );

      repo.last.add(const AssistantToolEvent('client_balance'));
      await tester.pump();
      expect(
        find.text(
          locale == 'fr'
              ? 'Je consulte le compte du client…'
              : 'نقرا حساب الزبون…',
        ),
        findsOneWidget,
      );
      expectNoOverflow(tester);

      repo.last
        ..add(const AssistantTextEvent('أحمد عليه 12 500,00 DA'))
        ..add(const AssistantDoneEvent(messageId: 'm1', truncated: true));
      await repo.last.end();
      await tester.pumpAndSettle();
      expect(find.textContaining('أحمد عليه'), findsOneWidget);
      expect(
        find.text(
          locale == 'fr'
              ? 'Réponse tronquée. Demandez la suite.'
              : 'الجواب تقطع. اطلب الباقي.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('assistant-send')), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('the quota error is translated, with its date, in $locale', (
      tester,
    ) async {
      repo.refusal = apiError(
        'AI_QUOTA_EXCEEDED',
        details: {'resetDate': '2026-12-01'},
        status: 429,
      );
      await pump(tester, locale);
      await ask(tester, 'Combien j\'ai vendu ?');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('assistant-failure')), findsOneWidget);
      expect(
        find.textContaining(
          locale == 'fr'
              ? 'Elles reviennent le 01/12/2026'
              : 'ترجع يوم 01/12/2026',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('AI_QUOTA_EXCEEDED'), findsNothing);
      // The question is back in the box.
      expect(find.text('Combien j\'ai vendu ?'), findsOneWidget);
      expectNoOverflow(tester);
    });

    testWidgets('the input stays above the keyboard in $locale', (
      tester,
    ) async {
      await pump(tester, locale);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      final input = tester.getRect(find.byKey(const Key('assistant-input')));
      expect(input.bottom, lessThanOrEqualTo(640 - 300));
      expectNoOverflow(tester);
    });
  }

  testWidgets('stop cancels and the screen leaving cancels', (tester) async {
    await pump(tester, 'fr');
    await ask(tester, 'question');
    await tester.tap(find.byKey(const Key('assistant-stop')));
    await tester.pumpAndSettle();
    expect(repo.last.token!.isCancelled, isTrue);
    expect(find.byKey(const Key('assistant-send')), findsOneWidget);

    await ask(tester, 'encore');
    final token = repo.last.token!;
    await tester.pumpWidget(const SizedBox());
    expect(token.isCancelled, isTrue);
  });

  testWidgets('a cut stream offers retry', (tester) async {
    await pump(tester, 'fr');
    await ask(tester, 'question');
    await repo.last.cut();
    await tester.pumpAndSettle();
    expect(find.textContaining('La connexion a été coupée'), findsOneWidget);
    await tester.tap(find.text('Réessayer'));
    await tester.pump();
    expect(repo.chats, hasLength(2));
    expect(repo.last.message, 'question');
  });

  // The keyboard opens (viewInsets.bottom 300) and closes (0): the chat must
  // get its full height back, the input bar back at the screen bottom (the
  // safe area stays inside the bar).
  for (final nested in [false, true]) {
    testWidgets('keyboard open then closed: full height back'
        '${nested ? ' (inside the shell\'s Scaffold)' : ''}', (tester) async {
      tester.view.padding = const FakeViewPadding(bottom: 24);
      addTearDown(tester.view.resetPadding);
      addTearDown(tester.view.resetViewInsets);
      await pumpScreen(
        tester,
        nested
            // As in MainScreen: an outer Scaffold that does not resize.
            ? const Scaffold(
                extendBody: true,
                resizeToAvoidBottomInset: false,
                body: Stack(children: [AssistantScreen()]),
              )
            : const AssistantScreen(),
        locale: 'ar',
        user: seller(),
        assistant: available,
      );
      final bar = find.byType(ChatInputBar);
      final screenBottom = phone360.height;
      final closedTop = tester.getTopLeft(bar).dy;
      expect(tester.getBottomLeft(bar).dy, screenBottom);

      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expect(tester.getBottomLeft(bar).dy, screenBottom - 300);
      expect(tester.getTopLeft(bar).dy, lessThan(closedTop));

      tester.view.viewInsets = FakeViewPadding.zero;
      await tester.pumpAndSettle();
      expect(tester.getBottomLeft(bar).dy, screenBottom);
      expect(tester.getTopLeft(bar).dy, closedTop);
      expectNoOverflow(tester);
    });
  }
}
