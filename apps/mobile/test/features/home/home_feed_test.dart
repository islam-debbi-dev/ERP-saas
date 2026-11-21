import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/catalog/data/models/home_feed.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/home/logic/home_feed_cubit.dart';

Map<String, dynamic> _product(String id, {num discount = 0}) => {
  'id': id,
  'storeId': 's1',
  'categoryId': 'c1',
  'name': 'Item $id',
  'price': 100,
  'finalPrice': 100 - discount,
  'discountPercentage': discount,
};

HomeFeed _feed({
  String? kind,
  String? scope,
  List<Map<String, dynamic>> products = const [],
}) => HomeFeed.fromJson({
  'orderingEnabled': true,
  'categories': [
    {'id': 'c1', 'name': 'Pizza', 'slug': 'pizza'},
  ],
  'featuredProducts': products,
  'featuredKind': ?kind,
  'featuredScope': ?scope,
});

void main() {
  test('newest products are never titled as deals', () {
    final state = HomeFeedState(
      feed: _feed(kind: 'newest', scope: 'group', products: [_product('p1')]),
    );

    expect(state.featured, hasLength(1));
    expect(state.featuredAreDeals, isFalse);
    expect(state.featuredCategoryIds, ['c1']);
  });

  test('deals from outside the group open the unfiltered deals list', () {
    final state = HomeFeedState(
      feed: _feed(
        kind: 'deals',
        scope: 'all',
        products: [_product('p1', discount: 20)],
      ),
    );

    expect(state.featuredAreDeals, isTrue);
    expect(state.featuredCategoryIds, isNull);
  });

  test('an older backend (no featuredKind) is judged by its products', () {
    final plain = _feed(products: [_product('p1')]);
    final deals = _feed(products: [_product('p1', discount: 10)]);

    expect(plain.featuredAreDeals, isFalse);
    expect(deals.featuredAreDeals, isTrue);
    expect(deals.featuredInGroup, isTrue);
    expect(const Product(
      id: 'p',
      storeId: 's',
      categoryId: 'c',
      name: 'n',
      price: 1,
      finalPrice: 1,
    ).discountPercentage, 0);
  });
}
