import 'package:orvynt_starter/features/catalog/data/models/product.dart';

/// "Assiette creuse" 400 DA (−10 %), Salade / Camembert +100, Œuf +50
/// (unavailable), free instructions.
Product assiette({num discount = 10}) => Product.fromJson({
  'id': 'a1',
  'storeId': 's1',
  'categoryId': 'c1',
  'name': 'Assiette creuse',
  'price': 400,
  'discountPercentage': discount,
  'finalPrice': (400 * (1 - discount / 100)).round(),
  'hasCustomisation': true,
  'optionGroups': [
    {
      'id': 'g1',
      'kind': 'supplement',
      'name': 'Suppléments',
      'minSelect': 0,
      'maxSelect': 3,
      'options': [
        {'id': 'salade', 'label': 'Salade', 'price': 100},
        {'id': 'camembert', 'label': 'Camembert', 'price': 100},
        {'id': 'oeuf', 'label': 'Œuf', 'price': 50, 'isAvailable': false},
      ],
    },
    {
      'id': 'g2',
      'kind': 'instruction',
      'name': 'Instructions',
      'minSelect': 0,
      'maxSelect': 2,
      'options': [
        {'id': 'sans-tomate', 'label': 'Sans tomate', 'price': 0},
        {'id': 'sans-frites', 'label': 'Sans frites', 'price': 0},
      ],
    },
  ],
});

/// "Pizza Tortels" L 800 / XL 1 100 / XXL 1 400 (unavailable), one
/// supplement max, and a required "Sauce" choice.
Product pizza() => Product.fromJson({
  'id': 'p9',
  'storeId': 's1',
  'categoryId': 'c1',
  'name': 'Pizza Tortels',
  'price': 800,
  'finalPrice': 800,
  'priceFrom': 800,
  'finalPriceFrom': 800,
  'hasSizes': true,
  'hasCustomisation': true,
  'requiresChoice': true,
  'variants': [
    {'id': 'L', 'label': 'L', 'price': 800, 'finalPrice': 800},
    {'id': 'XL', 'label': 'XL', 'price': 1100, 'finalPrice': 1100},
    {'id': 'XXL', 'label': 'XXL', 'price': 1400, 'isAvailable': false},
  ],
  'optionGroups': [
    {
      'id': 'g1',
      'kind': 'supplement',
      'name': 'Suppléments',
      'minSelect': 0,
      'maxSelect': 1,
      'options': [
        {'id': 'camembert', 'label': 'Camembert', 'price': 100},
        {'id': 'cheddar', 'label': 'Cheddar', 'price': 120},
      ],
    },
    {
      'id': 'g3',
      'kind': 'instruction',
      'name': 'Sauce',
      'minSelect': 1,
      'maxSelect': 1,
      'options': [
        {'id': 'harissa', 'label': 'Harissa'},
        {'id': 'mayo', 'label': 'Mayonnaise'},
      ],
    },
  ],
});
