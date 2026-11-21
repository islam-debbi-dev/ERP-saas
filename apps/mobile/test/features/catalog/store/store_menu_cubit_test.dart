import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/catalog/data/models/store.dart';
import 'package:orvynt_starter/features/catalog/ui/store/store_menu_cubit.dart';

import '../store_fixtures.dart';

void main() {
  // select() triggers a haptic, which needs the binding.
  TestWidgetsFlutterBinding.ensureInitialized();

  test('start loads the store sections and the "All" page together', () async {
    final repo = FakeCatalogRepository();
    final cubit = StoreMenuCubit(repository: repo, storeId: 's1');
    await cubit.start();

    expect(repo.storeCalls, 1);
    expect(repo.queries, hasLength(1));
    expect(repo.queries.single.categoryId, isNull);
    expect(repo.queries.single.toQuery()['includeClosed'], 'true');
    expect(cubit.state.categories.map((c) => c.id), [
      'pizzas',
      'plates',
      'drinks',
    ]);
    expect(cubit.state.store!.menuProductCount, 4);
    expect(cubit.state.selectedCategoryId, isNull);
    expect(cubit.products.state.items, hasLength(4));
    await cubit.close();
  });

  test('selecting a section resets the paging to that section only', () async {
    final repo = FakeCatalogRepository();
    final cubit = StoreMenuCubit(repository: repo, storeId: 's1');
    await cubit.start();

    await cubit.select('pizzas');
    expect(cubit.state.selectedCategoryId, 'pizzas');
    expect(repo.queries.last.categoryId, 'pizzas');
    expect(repo.queries.last.page, 1);
    expect(cubit.products.state.items.map((p) => p.categoryId).toSet(), {
      'pizzas',
    });

    // Same section again: nothing reloads.
    final calls = repo.queries.length;
    await cubit.select('pizzas');
    expect(repo.queries.length, calls);

    await cubit.select(null);
    expect(cubit.state.selectedCategoryId, isNull);
    expect(cubit.products.state.items, hasLength(4));
    await cubit.close();
  });

  test('a section that disappears on reload falls back to "All"', () async {
    final repo = FakeCatalogRepository();
    final cubit = StoreMenuCubit(repository: repo, storeId: 's1');
    await cubit.start();
    await cubit.select('drinks');

    final json = restaurant().toJson();
    repo.store = Store.fromJson({
      ...json,
      'categories': (json['categories'] as List).take(2).toList(),
    });
    await cubit.load();

    expect(cubit.state.selectedCategoryId, isNull);
    expect(repo.queries.last.categoryId, isNull);
    await cubit.close();
  });
}
