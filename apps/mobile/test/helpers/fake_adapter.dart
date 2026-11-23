import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// A recorded request.
class SentRequest {
  SentRequest(
    this.method,
    this.path,
    this.headers,
    this.body, [
    this.query = const {},
  ]);
  final String method;
  final String path;
  final Map<String, dynamic> headers;
  final Object? body;
  final Map<String, dynamic> query;
}

/// What the fake API answers: a status and a JSON body, or a thrown
/// [DioExceptionType] (timeout, connection error) to simulate the network.
class FakeReply {
  const FakeReply(this.status, [this.body]) : failure = null, chunks = null;
  const FakeReply.fail(this.failure) : status = 0, body = null, chunks = null;

  /// A streamed body (SSE): each item of [chunks] arrives as one network
  /// chunk; an error in it cuts the connection there.
  const FakeReply.stream(this.chunks, [this.status = 200])
    : body = null,
      failure = null;
  final int status;
  final Object? body;
  final DioExceptionType? failure;
  final Stream<List<int>>? chunks;
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
        Map.of(options.queryParameters),
      ),
    );
    final reply = handler(options);
    if (reply.failure != null) {
      throw DioException(requestOptions: options, type: reply.failure!);
    }
    final chunks = reply.chunks;
    if (chunks != null) {
      return ResponseBody(
        chunks.map(Uint8List.fromList),
        reply.status,
        headers: {
          Headers.contentTypeHeader: ['text/event-stream; charset=utf-8'],
        },
      );
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
