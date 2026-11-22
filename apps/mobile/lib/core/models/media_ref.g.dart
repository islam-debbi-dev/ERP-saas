// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_ref.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaRef _$MediaRefFromJson(Map<String, dynamic> json) => MediaRef(
  id: json['id'] as String,
  width: (json['width'] as num?)?.toInt(),
  height: (json['height'] as num?)?.toInt(),
  blurDataUrl: json['blurDataUrl'] as String?,
  urls:
      (json['urls'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(k, e as String),
      ) ??
      const {},
);

Map<String, dynamic> _$MediaRefToJson(MediaRef instance) => <String, dynamic>{
  'id': instance.id,
  'width': instance.width,
  'height': instance.height,
  'blurDataUrl': instance.blurDataUrl,
  'urls': instance.urls,
};
