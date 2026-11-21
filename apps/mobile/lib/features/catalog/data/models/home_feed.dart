import 'package:json_annotation/json_annotation.dart';

import 'category.dart';
import 'product.dart';
import 'store.dart';

part 'home_feed.g.dart';

/// `GET /home` — everything the home tab needs in one round trip.
/// `featuredProducts` are the discounted products, biggest discount first,
/// or the newest products when nothing is discounted: see [featuredAreDeals].
@JsonSerializable(explicitToJson: true)
class HomeFeed {
  final String shopName;
  final bool orderingEnabled;
  final num deliveryFee;

  /// Every Nth order of a client is delivered free; `0` = program off.
  final num freeDeliveryEveryOrders;

  /// The signed-in client's progress; `null` for guests or when off.
  final LoyaltyStatus? loyalty;
  final String supportPhone;
  final String supportPhone2;
  final List<Category> categories;
  final List<Product> featuredProducts;

  /// What [featuredProducts] holds: `deals` (discounted) or `newest`.
  /// `null` on a backend that predates the field.
  final String? featuredKind;

  /// Where they come from: `group` (the requested category group) or `all`
  /// (the section widened to the whole catalog).
  final String? featuredScope;
  final List<Store> stores;

  const HomeFeed({
    this.shopName = '',
    required this.orderingEnabled,
    this.deliveryFee = 0,
    this.freeDeliveryEveryOrders = 0,
    this.loyalty,
    this.supportPhone = '',
    this.supportPhone2 = '',
    this.categories = const [],
    this.featuredProducts = const [],
    this.featuredKind,
    this.featuredScope,
    this.stores = const [],
  });

  /// Only discounted products may be titled "Offers". An older backend sends
  /// no `featuredKind`, so the products themselves decide.
  bool get featuredAreDeals => switch (featuredKind) {
    'deals' => true,
    'newest' => false,
    _ =>
      featuredProducts.isNotEmpty &&
          featuredProducts.every((p) => p.discountPercentage > 0),
  };

  /// `false` when the row was filled from outside the requested group, so
  /// "see all" must not narrow to the group's categories either.
  bool get featuredInGroup => featuredScope != 'all';

  factory HomeFeed.fromJson(Map<String, dynamic> json) =>
      _$HomeFeedFromJson(json);

  Map<String, dynamic> toJson() => _$HomeFeedToJson(this);
}

/// `loyalty` in `GET /home`: orders counted since the last free delivery.
@JsonSerializable()
class LoyaltyStatus {
  final int everyOrders;
  final int ordersSinceFree;
  final int ordersUntilFree;
  final bool nextOrderFree;

  const LoyaltyStatus({
    required this.everyOrders,
    this.ordersSinceFree = 0,
    this.ordersUntilFree = 0,
    this.nextOrderFree = false,
  });

  /// Same counting as the backend, so the cart stays right until `/home`
  /// is fetched again. Only delivered orders count, so placing a paid order
  /// changes nothing; placing the free one uses the reward.
  LoyaltyStatus afterOrder({required bool wasFree}) {
    if (!wasFree) return this;
    final until = (everyOrders - 1).clamp(0, everyOrders);
    return LoyaltyStatus(
      everyOrders: everyOrders,
      ordersUntilFree: until,
      nextOrderFree: until == 0,
    );
  }

  factory LoyaltyStatus.fromJson(Map<String, dynamic> json) =>
      _$LoyaltyStatusFromJson(json);

  Map<String, dynamic> toJson() => _$LoyaltyStatusToJson(this);
}
