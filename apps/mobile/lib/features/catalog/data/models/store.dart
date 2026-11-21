import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/geo_point.dart';
import '../../../../core/models/media_ref.dart';
import 'product.dart';

part 'store.g.dart';

/// `GET /stores`, `/stores/:id`. The detail endpoint adds a `products`
/// preview (up to 12, empty while the store is closed) and the menu
/// [categories] (also for a closed store).
@JsonSerializable(explicitToJson: true)
class Store {
  final String id;
  final String name;
  final String slug;
  final String logo;
  final String cover;
  @JsonKey(fromJson: MediaRef.maybeFromJson)
  final MediaRef? logoMedia;
  @JsonKey(fromJson: MediaRef.maybeFromJson)
  final MediaRef? coverMedia;
  final String? description;
  final String phone;
  final String address;
  @JsonKey(fromJson: GeoPoint.maybeFromJson)
  final GeoPoint? location;
  final List<String> categoryIds;
  final bool isOpen;
  final List<OpeningHour> openingHours;
  final num minimumOrderAmount;
  final List<Product> products;

  /// Menu sections: the categories this store sells, in the admin order,
  /// each with its public product count. Only `GET /stores/:id` sends them.
  final List<StoreMenuCategory> categories;

  const Store({
    required this.id,
    required this.name,
    this.slug = '',
    this.logo = '',
    this.cover = '',
    this.logoMedia,
    this.coverMedia,
    this.description,
    this.phone = '',
    this.address = '',
    this.location,
    this.categoryIds = const [],
    this.isOpen = true,
    this.openingHours = const [],
    this.minimumOrderAmount = 0,
    this.products = const [],
    this.categories = const [],
  });

  /// Sum of the sections' counts, for the "All" pill.
  int get menuProductCount =>
      categories.fold<int>(0, (sum, c) => sum + c.productCount);

  factory Store.fromJson(Map<String, dynamic> json) => _$StoreFromJson(json);

  Map<String, dynamic> toJson() => _$StoreToJson(this);
}

/// `day` is 0 (Sunday) … 6; `open` / `close` are `HH:mm`.
@JsonSerializable()
class OpeningHour {
  final int day;
  final String open;
  final String close;

  const OpeningHour({
    required this.day,
    required this.open,
    required this.close,
  });

  factory OpeningHour.fromJson(Map<String, dynamic> json) =>
      _$OpeningHourFromJson(json);

  Map<String, dynamic> toJson() => _$OpeningHourToJson(this);
}

/// One menu section of a store (`GET /stores/:id` → `categories[]`).
@JsonSerializable(explicitToJson: true)
class StoreMenuCategory {
  final String id;
  final String name;
  final String slug;
  final String icon;
  final String image;
  @JsonKey(fromJson: MediaRef.maybeFromJson)
  final MediaRef? imageMedia;
  final int productCount;

  const StoreMenuCategory({
    required this.id,
    required this.name,
    this.slug = '',
    this.icon = '',
    this.image = '',
    this.imageMedia,
    this.productCount = 0,
  });

  factory StoreMenuCategory.fromJson(Map<String, dynamic> json) =>
      _$StoreMenuCategoryFromJson(json);

  Map<String, dynamic> toJson() => _$StoreMenuCategoryToJson(this);
}
