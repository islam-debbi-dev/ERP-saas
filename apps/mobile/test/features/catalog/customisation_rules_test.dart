import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/catalog/logic/customisation_rules.dart';

import 'customisation_fixtures.dart';

ProductOptionGroup _group(Product p, String id) =>
    p.optionGroups.firstWhere((g) => g.id == id);

ProductOption _option(Product p, String groupId, String id) =>
    _group(p, groupId).options.firstWhere((o) => o.id == id);

void main() {
  group('lineKeyOf', () {
    test('matches the server key and sorts option ids', () {
      expect(lineKeyOf('p1'), 'p1||');
      expect(
        lineKeyOf('p1', variantId: 'v2', optionIds: ['b', 'a', 'b']),
        'p1|v2|a,b',
      );
    });
  });

  group('assiette (supplements + instructions, no sizes)', () {
    final product = assiette();
    final rules = CustomisationRules(product);

    test('nothing ticked is valid and costs the discounted base', () {
      final s = rules.initial();
      expect(rules.isValid(s), isTrue);
      expect(rules.unitPrice(s), 360);
    });

    test(
      'supplements are added per unit, never discounted; instructions free',
      () {
        var s = rules.initial();
        s = rules.toggle(
          s,
          _group(product, 'g1'),
          _option(product, 'g1', 'salade'),
        );
        s = rules.toggle(
          s,
          _group(product, 'g1'),
          _option(product, 'g1', 'camembert'),
        );
        s = rules.toggle(
          s,
          _group(product, 'g2'),
          _option(product, 'g2', 'sans-tomate'),
        );
        expect(rules.unitPrice(s), 560);
        expect(rules.total(s, 2), 1120);
        expect(rules.lineKey(s), 'a1||camembert,salade,sans-tomate');
        expect(rules.chosenOptions(s).map((o) => o.kind), [
          'supplement',
          'supplement',
          'instruction',
        ]);
      },
    );

    test(
      'an unavailable option cannot be ticked, a ticked one can be unticked',
      () {
        var s = rules.toggle(
          rules.initial(),
          _group(product, 'g1'),
          _option(product, 'g1', 'oeuf'),
        );
        expect(s.optionIds, isEmpty);
        s = rules.toggle(
          s,
          _group(product, 'g1'),
          _option(product, 'g1', 'salade'),
        );
        s = rules.toggle(
          s,
          _group(product, 'g1'),
          _option(product, 'g1', 'salade'),
        );
        expect(s.optionIds, isEmpty);
      },
    );
  });

  group('pizza (sizes + restricted groups)', () {
    final product = pizza();
    final rules = CustomisationRules(product);

    test('needs a size, then the required sauce', () {
      var s = rules.initial();
      expect(s.variantId, isNull);
      expect(rules.problem(s), isA<NeedSize>());

      s = rules.selectVariant(s, product.variants[1]);
      final problem = rules.problem(s);
      expect(problem, isA<GroupRuleBroken>());
      expect((problem as GroupRuleBroken).group.name, 'Sauce');

      s = rules.toggle(
        s,
        _group(product, 'g3'),
        _option(product, 'g3', 'mayo'),
      );
      expect(rules.isValid(s), isTrue);
    });

    test('an unavailable size is never selected', () {
      final s = rules.selectVariant(rules.initial(), product.variants[2]);
      expect(s.variantId, isNull);
    });

    test(
      'a single-choice group swaps the choice; a required one cannot be emptied',
      () {
        var s = rules.selectVariant(rules.initial(), product.variants[1]);
        final supp = _group(product, 'g1');
        s = rules.toggle(s, supp, _option(product, 'g1', 'camembert'));
        s = rules.toggle(s, supp, _option(product, 'g1', 'cheddar'));
        expect(s.optionIds, {'cheddar'});

        final sauce = _group(product, 'g3');
        s = rules.toggle(s, sauce, _option(product, 'g3', 'harissa'));
        s = rules.toggle(s, sauce, _option(product, 'g3', 'harissa'));
        expect(s.optionIds, containsAll(['cheddar', 'harissa']));
      },
    );

    test('XL + camembert = size price + 100', () {
      var s = rules.selectVariant(rules.initial(), product.variants[1]);
      s = rules.toggle(
        s,
        _group(product, 'g1'),
        _option(product, 'g1', 'camembert'),
      );
      s = rules.toggle(
        s,
        _group(product, 'g3'),
        _option(product, 'g3', 'harissa'),
      );
      expect(rules.unitPrice(s), 1200);
      final line = rules.toLine(s, 1);
      expect(line.variantLabel, 'XL');
      expect(line.lineKey, 'p9|XL|camembert,harissa');
    });

    test('pre-selects the only available size', () {
      final one = Product.fromJson({
        ...pizza().toJson(),
        'variants': [
          {'id': 'L', 'label': 'L', 'price': 800},
          {'id': 'XL', 'label': 'XL', 'price': 1100, 'isAvailable': false},
        ],
      });
      expect(CustomisationRules(one).initial().variantId, 'L');
    });

    test('applies the discount to the size price only', () {
      expect(applyDiscount(1100, 10), 990);
    });
  });

  test('old responses without customisation still parse', () {
    final p = Product.fromJson({
      'id': 'x',
      'storeId': 's',
      'categoryId': 'c',
      'name': 'Soap',
      'price': 110,
      'finalPrice': 110,
    });
    expect(p.isCustomisable, isFalse);
    expect(p.displayPrice, 110);
  });
}
