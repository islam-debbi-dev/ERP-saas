/// Category groups behind the Home (food), "Fruits & Vegetables" and
/// "Supermarket" tabs.
///
/// The backend has no product-type field, so a tab is defined by the category
/// slugs it shows (seeded in `backend/src/seed/seedCategories.js`). Edit the
/// lists here to change what a tab contains; order = chip order.
enum CategoryGroup {
  /// Home tab: restaurants, fast food, desserts and drinks to go.
  food([
    ...fastFoodSlugs,
    'grills',
    'pasta',
    'seafood',
    'traditional',
    'couscous',
    'tajine',
    'soup',
    'salads',
    'breakfast',
    'crepes',
    'pastries',
    'desserts',
    'ice-cream',
    'juices',
    'smoothies',
    'coffee',
    'tea',
    'soft-drinks',
  ]),
  produce(['fruits', 'vegetables']),
  supermarket([
    'grocery',
    'dairy',
    'meat',
    'bakery',
    'drinks',
    'snacks',
    'household',
    'personal-care',
  ]);

  const CategoryGroup(this.slugs);

  final List<String> slugs;

  /// The fast-food part of [food] (first in its chip order): what the home
  /// feed continues with once "Popular dishes" has no page left.
  static const List<String> fastFood = fastFoodSlugs;
}

/// Single source of the fast-food slugs: [CategoryGroup.food] starts with
/// them and [CategoryGroup.fastFood] exposes them.
const fastFoodSlugs = [
  'burger',
  'pizza',
  'tacos',
  'sandwich',
  'fried-chicken',
  'wraps',
  'hot-dog',
];
