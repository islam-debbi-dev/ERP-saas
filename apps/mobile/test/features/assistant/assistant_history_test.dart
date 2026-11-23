import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/models/paginated.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_repository.dart';
import 'package:orvynt_starter/features/assistant/ui/assistant_screen.dart';

import '../../helpers/pump_app.dart';
import 'assistant_fakes.dart';

AssistantConversation conv(String id, String title) => AssistantConversation(
  id: id,
  title: title,
  createdAt: DateTime.utc(2026, 11, 22, 13, 5),
);

void main() {
  late FakeAssistantRepository repo;

  setUp(() {
    repo = FakeAssistantRepository();
    getIt.registerSingleton<AssistantRepository>(repo);
  });
  tearDown(() => getIt.reset());

  Future<void> openHistory(WidgetTester tester, String locale) async {
    await pumpScreen(
      tester,
      const AssistantScreen(),
      locale: locale,
      user: supervisor(),
      assistant: const AssistantStatus(available: true, provider: 'ANTHROPIC'),
    );
    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pumpAndSettle();
  }

  for (final locale in ['ar', 'fr']) {
    testWidgets('history list with load more in $locale', (tester) async {
      repo.pages = (cursor) => ApiResult.success(
        cursor == null
            ? Paginated(
                items: [
                  conv('c1', 'شحال الكريدي تاع أحمد؟'),
                  conv(
                    'c2',
                    'Combien mon équipe a vendu cette semaine, par vendeur et par jour ?',
                  ),
                ],
                nextCursor: 'c2',
              )
            : Paginated(items: [conv('c3', 'Stock eau 1,5 L')]),
      );
      await openHistory(tester, locale);
      expect(find.textContaining('أحمد'), findsOneWidget);
      expect(find.textContaining('22/11/2026'), findsNWidgets(2));
      expectNoOverflow(tester);

      await tester.tap(find.byType(OutlinedButton));
      await tester.pumpAndSettle();
      expect(find.text('Stock eau 1,5 L'), findsOneWidget);
      expect(find.byType(OutlinedButton), findsNothing);
      expectNoOverflow(tester);
    });

    testWidgets('empty history in $locale', (tester) async {
      await openHistory(tester, locale);
      expect(find.byIcon(Icons.history), findsWidgets);
      expect(
        find.text(
          locale == 'fr'
              ? 'Aucune conversation pour le moment.'
              : 'لا توجد محادثات بعد.',
        ),
        findsOneWidget,
      );
      expectNoOverflow(tester);
    });

    testWidgets('history error in $locale', (tester) async {
      repo.pages = (_) => ApiResult.failure(apiError('INTERNAL_ERROR'));
      await openHistory(tester, locale);
      expect(find.byIcon(Icons.wifi_off_rounded), findsOneWidget);
      expectNoOverflow(tester);
    });
  }

  testWidgets('open a conversation, rate an answer, revert on failure', (
    tester,
  ) async {
    repo.pages = (_) =>
        ApiResult.success(Paginated(items: [conv('c1', 'Question')]));
    repo.detail = const ApiResult.success(
      AssistantConversationDetail(
        id: 'c1',
        messages: [
          AssistantMessage(id: 'u1', fromUser: true, content: 'Question'),
          AssistantMessage(id: 'a1', fromUser: false, content: 'Réponse'),
        ],
      ),
    );
    await openHistory(tester, 'fr');
    await tester.tap(find.text('Question'));
    await tester.pumpAndSettle();
    expect(find.text('Réponse'), findsOneWidget);

    await tester.tap(find.byKey(const Key('assistant-useful')));
    await tester.pumpAndSettle();
    expect(repo.feedbacks.single, ('a1', true));
    expect(
      tester
          .widget<IconButton>(find.byKey(const Key('assistant-useful')))
          .isSelected,
      isTrue,
    );

    repo.feedbackFails = true;
    await tester.tap(find.byKey(const Key('assistant-not-useful')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<IconButton>(find.byKey(const Key('assistant-useful')))
          .isSelected,
      isTrue,
      reason: 'put back when the API did not save it',
    );
    expect(
      find.text('Votre avis n\'a pas été enregistré. Réessayez.'),
      findsOneWidget,
    );
    expectNoOverflow(tester);
  });

  testWidgets('delete asks first, then the open conversation resets', (
    tester,
  ) async {
    repo.pages = (_) =>
        ApiResult.success(Paginated(items: [conv('c1', 'Question')]));
    repo.detail = const ApiResult.success(
      AssistantConversationDetail(
        id: 'c1',
        messages: [
          AssistantMessage(id: 'u1', fromUser: true, content: 'Question'),
          AssistantMessage(id: 'a1', fromUser: false, content: 'Réponse'),
        ],
      ),
    );
    await openHistory(tester, 'fr');
    await tester.tap(find.text('Question'));
    await tester.pumpAndSettle();
    expect(find.text('Réponse'), findsOneWidget);

    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.delete_outline));
    await tester.pumpAndSettle();
    // Cancel keeps it.
    await tester.tap(find.text('Annuler'));
    await tester.pumpAndSettle();
    expect(repo.deleted, isEmpty);

    await tester.tap(find.byIcon(Icons.delete_outline));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-delete-confirm')));
    await tester.pumpAndSettle();
    expect(repo.deleted, ['c1']);
    expect(find.text('Aucune conversation pour le moment.'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Réponse'), findsNothing);
    expect(find.text('Comment puis-je vous aider ?'), findsOneWidget);
  });
}
