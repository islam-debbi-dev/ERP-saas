import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/media_ref.dart';

part 'category.g.dart';

/// `GET /categories`, `/categories/:id` — `name` arrives localized.
@JsonSerializable(explicitToJson: true)
class Category {
  final String id;
  final String name;
  final String slug;
  final String icon;
  final String image;
  @JsonKey(fromJson: MediaRef.maybeFromJson)
  final MediaRef? imageMedia;
  final int order;

  const Category({
    required this.id,
    required this.name,
    required this.slug,
    this.icon = '',
    this.image = '',
    this.imageMedia,
    this.order = 0,
  });

  factory Category.fromJson(Map<String, dynamic> json) =>
      _$CategoryFromJson(json);

  Map<String, dynamic> toJson() => _$CategoryToJson(this);
}
