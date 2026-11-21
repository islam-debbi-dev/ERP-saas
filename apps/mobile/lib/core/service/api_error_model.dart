import 'package:json_annotation/json_annotation.dart';

part 'api_error_model.g.dart';

@JsonSerializable()
class ApiErrorModel {
  // use json key whene  @JsonKey(name: "error")
  final String? code;
  final String? message;

  /// `error.details` of the backend envelope (e.g. `[{ field: "items.2" }]`).
  @JsonKey(includeToJson: false)
  final List<dynamic>? details;

  ApiErrorModel({this.code, this.message, this.details});

  factory ApiErrorModel.fromJson(Map<String, dynamic> json) =>
      _$ApiErrorModelFromJson(json);

  Map<String, dynamic> toJson() => _$ApiErrorModelToJson(this);
}
