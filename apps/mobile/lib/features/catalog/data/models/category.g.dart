// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'category.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Category _$CategoryFromJson(Map<String, dynamic> json) => Category(
  id: json['id'] as String,
  name: json['name'] as String,
  slug: json['slug'] as String,
  icon: json['icon'] as String? ?? '',
  image: json['image'] as String? ?? '',
  imageMedia: MediaRef.maybeFromJson(json['imageMedia']),
  order: (json['order'] as num?)?.toInt() ?? 0,
);

Map<String, dynamic> _$CategoryToJson(Category instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'slug': instance.slug,
  'icon': instance.icon,
  'image': instance.image,
  'imageMedia': instance.imageMedia?.toJson(),
  'order': instance.order,
};
