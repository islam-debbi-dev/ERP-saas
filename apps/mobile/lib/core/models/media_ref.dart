import 'package:json_annotation/json_annotation.dart';

import '../network/image_url.dart';

part 'media_ref.g.dart';

/// An optimized image from the backend pipeline:
/// `{ id, width, height, blurDataUrl, urls: { thumb, small, medium, large } }`.
/// Legacy images have no `media` object and only a plain URL.
@JsonSerializable()
class MediaRef {
  final String id;
  final int? width;
  final int? height;

  /// Tiny WebP (`data:image/webp;base64,…`) shown while the real image loads.
  final String? blurDataUrl;
  final Map<String, String> urls;

  const MediaRef({
    required this.id,
    this.width,
    this.height,
    this.blurDataUrl,
    this.urls = const {},
  });

  /// URL of [size], falling back to the next larger then smaller size.
  String? urlFor(ImageSize size) {
    final order = [
      size,
      ...ImageSize.values.where((s) => s.index > size.index),
      ...ImageSize.values.reversed.where((s) => s.index < size.index),
    ];
    for (final s in order) {
      final url = urls[s.name];
      if (url != null && url.isNotEmpty) return url;
    }
    return null;
  }

  double? get aspectRatio =>
      width != null && height != null && height! > 0 ? width! / height! : null;

  static MediaRef? maybeFromJson(dynamic json) =>
      json is Map<String, dynamic> ? MediaRef.fromJson(json) : null;

  factory MediaRef.fromJson(Map<String, dynamic> json) =>
      _$MediaRefFromJson(json);

  Map<String, dynamic> toJson() => _$MediaRefToJson(this);
}
