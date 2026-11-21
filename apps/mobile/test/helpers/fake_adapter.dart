import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// A recorded request.
class SentRequest {
  SentRequest(this.method, this.path, this.headers, this.body);
  final String method;
  final String path;
  final Map<String, dynamic> headers;
  final Object? body;
}

/// What the fake API answers: a status and a JSON body, or a thrown
/// [DioExceptionType] (timeout, connection error) to simulate the network.
class FakeReply {
  const FakeReply(this.status, [this.body]) : failure = null;
  const FakeReply.fail(this.failure) : status = 0, body = null;
  final int status;
  final Object? body;
  final DioExceptionType? failure;
}

/// Dio adapter answering from a handler, recording every request.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final FakeReply Function(RequestOptions options) handler;
  final List<SentRequest> sent = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    sent.add(
      SentRequest(
        options.method,
        options.path,
        Map.of(options.headers),
        options.data,
      ),
    );
    final reply = handler(options);
    if (reply.failure != null) {
      throw DioException(requestOptions: options, type: reply.failure!);
    }
    return ResponseBody.fromString(
      reply.body == null ? '' : jsonEncode(reply.body),
      reply.status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
