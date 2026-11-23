import 'dart:convert';

import 'assistant_models.dart';

/// Reads the body of `POST /assistant/chat` (SSE over POST) as events.
///
/// The bytes go through a chunked UTF-8 decoder (an Arabic letter cut
/// between two chunks stays whole) and a line splitter (`\n` or `\r\n`).
/// `data:` lines collect until a blank line, then their JSON is one
/// [AssistantStreamEvent]. Comments (`:`), other fields, unreadable JSON and
/// unknown types are skipped. When the body ends in the middle of an event,
/// that partial event is dropped: the caller sees no `done` and knows the
/// stream was cut.
Stream<AssistantStreamEvent> decodeAssistantSse(
  Stream<List<int>> bytes,
) async* {
  final data = <String>[];
  // `bind`, not `transform`: the body is a `Stream<Uint8List>`, which
  // `Stream.transform` refuses for a `List<int>` decoder at run time.
  final lines = const LineSplitter().bind(utf8.decoder.bind(bytes));
  await for (final line in lines) {
    if (line.isEmpty) {
      if (data.isNotEmpty) {
        final event = _parse(data.join('\n'));
        data.clear();
        if (event != null) yield event;
      }
      continue;
    }
    if (line.startsWith(':')) continue;
    final colon = line.indexOf(':');
    final field = colon < 0 ? line : line.substring(0, colon);
    if (field != 'data') continue;
    var value = colon < 0 ? '' : line.substring(colon + 1);
    if (value.startsWith(' ')) value = value.substring(1);
    data.add(value);
  }
}

AssistantStreamEvent? _parse(String payload) {
  try {
    final json = jsonDecode(payload);
    return json is Map<String, dynamic>
        ? AssistantStreamEvent.fromJson(json)
        : null;
  } on FormatException {
    return null;
  } on TypeError {
    // A known type with a missing field: skipped like an unknown one.
    return null;
  }
}
