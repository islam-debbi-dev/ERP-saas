import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/logic/assistant_chat_cubit.dart';

import 'assistant_fakes.dart';

void main() {
  late FakeAssistantRepository repo;
  late AssistantChatCubit cubit;

  setUp(() {
    repo = FakeAssistantRepository();
    cubit = AssistantChatCubit(repo);
  });

  tearDown(() => cubit.close());

  test('idle → streaming → done', () async {
    expect(cubit.state.phase, ChatPhase.idle);
    final sent = cubit.send('  شحال الكريدي تاع أحمد؟ ');
    await pumpEventQueue();
    expect(cubit.state.phase, ChatPhase.streaming);
    expect(cubit.state.waiting, isTrue);
    expect(repo.last.message, 'شحال الكريدي تاع أحمد؟');
    expect(repo.last.conversationId, isNull);

    repo.last
      ..add(const AssistantConversationEvent('c1'))
      ..add(const AssistantToolEvent('client_balance'));
    await pumpEventQueue();
    expect(cubit.state.tool, 'client_balance');
    expect(cubit.state.conversationId, 'c1');

    repo.last
      ..add(const AssistantTextEvent('أحمد عليه '))
      ..add(const AssistantTextEvent('12 500,00 DA'));
    await pumpEventQueue();
    expect(cubit.state.tool, isNull, reason: 'text clears the tool line');
    expect(cubit.state.messages.last.content, 'أحمد عليه 12 500,00 DA');

    repo.last
      ..add(
        const AssistantLinksEvent([
          AssistantLink(label: 'أحمد', href: '/clients/x'),
        ]),
      )
      ..add(const AssistantDoneEvent(messageId: 'm1', truncated: true));
    await repo.last.end();
    expect(await sent, isTrue);

    final answer = cubit.state.messages.last;
    expect(cubit.state.phase, ChatPhase.done);
    expect(answer.id, 'm1');
    expect(answer.truncated, isTrue);
    expect(answer.links.single.href, '/clients/x');
    expect(cubit.state.messages, hasLength(2));

    // The next question goes in the same conversation.
    cubit.send('Et Karim ?');
    await pumpEventQueue();
    expect(repo.last.conversationId, 'c1');
  });

  test('replace overwrites what was streamed', () async {
    cubit.send('question');
    await pumpEventQueue();
    repo.last
      ..add(const AssistantTextEvent('Le client X doit'))
      ..add(const AssistantReplaceEvent('Je ne peux pas répondre à cela.'))
      ..add(const AssistantDoneEvent(messageId: 'm1'));
    await repo.last.end();
    await pumpEventQueue();
    expect(
      cubit.state.messages.last.content,
      'Je ne peux pas répondre à cela.',
    );
  });

  test('send is ignored while an answer streams', () async {
    cubit.send('one');
    await pumpEventQueue();
    expect(await cubit.send('two'), isFalse);
    expect(repo.chats, hasLength(1));
  });

  test('a refusal before the stream: error, bubbles gone, retry', () async {
    repo.refusal = apiError(
      'AI_QUOTA_EXCEEDED',
      details: {'resetDate': '2026-12-01'},
      status: 429,
    );
    expect(await cubit.send('question'), isFalse);
    expect(cubit.state.phase, ChatPhase.error);
    expect(cubit.state.messages, isEmpty);
    expect(cubit.state.failure!.error!.code, 'AI_QUOTA_EXCEEDED');
    expect(cubit.state.failure!.resetDate, '2026-12-01');
    expect(cubit.state.conversationId, isNull);

    repo.refusal = null;
    cubit.retry();
    await pumpEventQueue();
    expect(cubit.state.phase, ChatPhase.streaming);
    expect(cubit.state.failure, isNull);
    expect(repo.last.message, 'question');
  });

  test('an error event after some text keeps the text', () async {
    cubit.send('question');
    await pumpEventQueue();
    repo.last
      ..add(const AssistantConversationEvent('c1'))
      ..add(const AssistantTextEvent('Début'))
      ..add(const AssistantErrorEvent('AI_UNAVAILABLE'));
    await repo.last.end();
    await pumpEventQueue();
    expect(cubit.state.phase, ChatPhase.error);
    expect(cubit.state.failure!.error!.code, 'AI_UNAVAILABLE');
    expect(cubit.state.messages.last.content, 'Début');
    expect(cubit.state.conversationId, 'c1');
  });

  test(
    'an error event with nothing written forgets a new conversation',
    () async {
      cubit.send('question');
      await pumpEventQueue();
      repo.last
        ..add(const AssistantConversationEvent('c1'))
        ..add(const AssistantErrorEvent('AI_RATE_LIMITED'));
      await repo.last.end();
      await pumpEventQueue();
      expect(cubit.state.messages, isEmpty);
      expect(cubit.state.conversationId, isNull);
    },
  );

  test('stop → cancelled, the partial answer stays', () async {
    final sent = cubit.send('question');
    await pumpEventQueue();
    repo.last.add(const AssistantTextEvent('Une partie'));
    await pumpEventQueue();
    cubit.stop();
    expect(await sent, isTrue);
    expect(cubit.state.phase, ChatPhase.cancelled);
    expect(cubit.state.failure, isNull);
    expect(cubit.state.messages.last.content, 'Une partie');
    expect(repo.last.token!.isCancelled, isTrue);
  });

  test('stop before any text drops the empty answer only', () async {
    cubit.send('question');
    await pumpEventQueue();
    cubit.stop();
    await pumpEventQueue();
    expect(cubit.state.phase, ChatPhase.cancelled);
    expect(cubit.state.messages.single.fromUser, isTrue);
  });

  test(
    'a cut stream (no done) → error, retry does not repeat the question',
    () async {
      cubit.send('question');
      await pumpEventQueue();
      repo.last.add(const AssistantConversationEvent('c1'));
      await repo.last.cut();
      await pumpEventQueue();
      expect(cubit.state.phase, ChatPhase.error);
      expect(cubit.state.failure!.cut, isTrue);
      expect(cubit.state.messages.single.fromUser, isTrue);

      cubit.retry();
      await pumpEventQueue();
      expect(
        cubit.state.messages.where((m) => m.fromUser),
        hasLength(1),
        reason: 'the unanswered question is not shown twice',
      );
      expect(repo.last.conversationId, 'c1');
    },
  );

  test('a stream that ends without done is a cut too', () async {
    cubit.send('question');
    await pumpEventQueue();
    repo.last.add(const AssistantTextEvent('Le client'));
    await repo.last.end();
    await pumpEventQueue();
    expect(cubit.state.phase, ChatPhase.error);
    expect(cubit.state.failure!.cut, isTrue);
    expect(cubit.state.messages.last.content, 'Le client');
  });

  test('closing the cubit cancels the request', () async {
    cubit.send('question');
    await pumpEventQueue();
    final token = repo.last.token!;
    await cubit.close();
    expect(token.isCancelled, isTrue);
  });

  test('reset starts a new conversation', () async {
    cubit.send('question');
    await pumpEventQueue();
    repo.last
      ..add(const AssistantConversationEvent('c1'))
      ..add(const AssistantTextEvent('ok'));
    await pumpEventQueue();
    cubit.reset();
    expect(cubit.state.phase, ChatPhase.idle);
    expect(cubit.state.messages, isEmpty);
    expect(cubit.state.conversationId, isNull);
  });

  test('open loads a stored conversation', () async {
    repo.detail = const ApiResult.success(
      AssistantConversationDetail(
        id: 'c9',
        messages: [
          AssistantMessage(id: 'u1', fromUser: true, content: 'Q'),
          AssistantMessage(
            id: 'a1',
            fromUser: false,
            content: 'R',
            useful: true,
            links: [AssistantLink(label: 'V', href: '/ventes/1')],
          ),
        ],
      ),
    );
    await cubit.open('c9');
    expect(cubit.state.conversationId, 'c9');
    expect(cubit.state.messages.map((m) => m.content), ['Q', 'R']);
    expect(cubit.state.messages.last.useful, isTrue);
    expect(cubit.state.opening, isFalse);
  });

  test('rate shows at once and is put back when not saved', () async {
    repo.detail = const ApiResult.success(
      AssistantConversationDetail(
        id: 'c9',
        messages: [AssistantMessage(id: 'a1', fromUser: false, content: 'R')],
      ),
    );
    await cubit.open('c9');
    await cubit.rate('a1', useful: true);
    expect(cubit.state.messages.single.useful, isTrue);
    expect(repo.feedbacks.single, ('a1', true));

    repo.feedbackFails = true;
    await cubit.rate('a1', useful: false);
    expect(cubit.state.messages.single.useful, isTrue);
    expect(cubit.state.feedbackFailures, 1);
  });
}
