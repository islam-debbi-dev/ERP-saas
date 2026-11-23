import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/network/api_error.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_repository.dart';
import 'package:orvynt_starter/features/assistant/data/sse_parser.dart';

import '../../helpers/fake_adapter.dart';

/// `data: {json}\n\n`, as the API's `send()` writes it.
String sse(Map<String, Object?> event) => 'data: ${jsonEncode(event)}\n\n';

Stream<List<int>> chunksOf(List<List<int>> chunks) =>
    Stream.fromIterable(chunks);

Future<List<AssistantStreamEvent>> decode(List<List<int>> chunks) =>
    decodeAssistantSse(chunksOf(chunks)).toList();

void main() {
  group('decodeAssistantSse', () {
    test('an event split over two chunks', () async {
      final bytes = utf8.encode(sse({'type': 'text', 'delta': 'Bonjour'}));
      final events = await decode([bytes.sublist(0, 9), bytes.sublist(9)]);
      expect(events.single, isA<AssistantTextEvent>());
      expect((events.single as AssistantTextEvent).delta, 'Bonjour');
    });

    test('an Arabic letter cut between two chunks stays whole', () async {
      final bytes = utf8.encode(sse({'type': 'text', 'delta': 'الكريدي'}));
      // Cut in the middle of a 2-byte letter.
      final cut = utf8.encode('data: {"type":"text","delta":"ا').length - 1;
      final events = await decode([bytes.sublist(0, cut), bytes.sublist(cut)]);
      expect((events.single as AssistantTextEvent).delta, 'الكريدي');
    });

    test('several events in one chunk, in order', () async {
      final body = [
        sse({'type': 'conversation', 'conversationId': 'c1'}),
        sse({'type': 'tool', 'name': 'client_balance'}),
        sse({'type': 'text', 'delta': 'Il doit '}),
        sse({
          'type': 'links',
          'links': [
            {'label': 'Ahmed', 'href': '/clients/x'},
          ],
        }),
        sse({
          'type': 'done',
          'messageId': 'm1',
          'conversationId': 'c1',
          'truncated': true,
        }),
      ].join();
      final events = await decode([utf8.encode(body)]);
      expect(events.map((e) => e.runtimeType).toList(), [
        AssistantConversationEvent,
        AssistantToolEvent,
        AssistantTextEvent,
        AssistantLinksEvent,
        AssistantDoneEvent,
      ]);
      expect((events[1] as AssistantToolEvent).name, 'client_balance');
      expect(
        (events[3] as AssistantLinksEvent).links.single.href,
        '/clients/x',
      );
      final done = events.last as AssistantDoneEvent;
      expect(done.messageId, 'm1');
      expect(done.truncated, isTrue);
    });

    test('replace and error events', () async {
      final events = await decode([
        utf8.encode(
          sse({'type': 'replace', 'text': 'Je ne peux pas répondre.'}) +
              sse({'type': 'error', 'code': 'AI_UNAVAILABLE'}),
        ),
      ]);
      expect(
        (events[0] as AssistantReplaceEvent).text,
        'Je ne peux pas répondre.',
      );
      expect((events[1] as AssistantErrorEvent).code, 'AI_UNAVAILABLE');
    });

    test('CRLF lines, comments, other fields and unknown types', () async {
      final body =
          ': keep-alive\r\n\r\n'
          'event: message\r\ndata: {"type":"text","delta":"a"}\r\n\r\n'
          'data: {"type":"future_thing"}\n\n'
          'data: not json\n\n'
          'data: {"type":"text","delta":"b"}\n\n';
      final events = await decode([utf8.encode(body)]);
      expect(events.map((e) => (e as AssistantTextEvent).delta), ['a', 'b']);
    });

    test('a stream cut in the middle drops the partial event', () async {
      final body =
          '${sse({'type': 'text', 'delta': 'Le client '})}'
          'data: {"type":"text","del';
      final events = await decode([utf8.encode(body)]);
      expect(events, hasLength(1));
      expect(events.whereType<AssistantDoneEvent>(), isEmpty);
    });
  });

  group('AssistantRepository.chat', () {
    late FakeAdapter adapter;
    late FakeReply reply;
    late AssistantRepository repo;

    setUp(() {
      adapter = FakeAdapter((_) => reply);
      repo = AssistantRepository(
        ApiClient(dio: Dio()..httpClientAdapter = adapter),
      );
    });

    test('streams the events of the answer', () async {
      reply = FakeReply.stream(
        chunksOf([
          utf8.encode(sse({'type': 'text', 'delta': 'Sa'})),
          utf8.encode(sse({'type': 'text', 'delta': 'lut'})),
          utf8.encode(sse({'type': 'done', 'messageId': 'm1'})),
        ]),
      );
      final result = await repo.chat(message: 'Salut', conversationId: 'c1');
      final events = await (result as Success<Stream<AssistantStreamEvent>>)
          .data
          .toList();
      expect(events, hasLength(3));
      final sent = adapter.sent.single;
      expect(sent.path, '/assistant/chat');
      expect(sent.body, {'message': 'Salut', 'conversationId': 'c1'});
      expect(sent.headers['Accept'], 'text/event-stream');
    });

    test('a new conversation sends no conversationId', () async {
      reply = FakeReply.stream(chunksOf(const []));
      await repo.chat(message: 'Salut');
      expect(adapter.sent.single.body, {'message': 'Salut'});
    });

    test('a refusal before the stream is a normal JSON error', () async {
      reply = FakeReply.stream(
        chunksOf([
          utf8.encode(
            jsonEncode({
              'code': 'AI_QUOTA_EXCEEDED',
              'message': 'Monthly question quota reached',
              'details': {'resetDate': '2026-12-01'},
            }),
          ),
        ]),
        429,
      );
      final result = await repo.chat(message: 'Salut');
      final error = (result as Failure).error;
      expect(error.kind, ApiErrorKind.server);
      expect(error.code, 'AI_QUOTA_EXCEEDED');
      expect(error.detail('resetDate'), '2026-12-01');
      expect(error.statusCode, 429);
    });

    test(
      'a connection lost mid-answer throws after the first events',
      () async {
        final controller = StreamController<List<int>>();
        reply = FakeReply.stream(controller.stream);
        final result = await repo.chat(message: 'Salut');
        final stream = (result as Success<Stream<AssistantStreamEvent>>).data;
        final got = <AssistantStreamEvent>[];
        final done = stream.listen(got.add).asFuture<void>();
        controller.add(utf8.encode(sse({'type': 'text', 'delta': 'Le '})));
        controller.addError(const SocketLikeError());
        await controller.close();
        await expectLater(done, throwsA(isA<SocketLikeError>()));
        expect(got, hasLength(1));
      },
    );

    test('the network down before the stream is offline', () async {
      reply = const FakeReply.fail(DioExceptionType.connectionError);
      final result = await repo.chat(message: 'Salut');
      expect((result as Failure).error.kind, ApiErrorKind.offline);
    });
  });
}

class SocketLikeError implements Exception {
  const SocketLikeError();
}
