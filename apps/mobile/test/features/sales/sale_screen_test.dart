import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/catalog/data/models/product.dart';
import 'package:orvynt_starter/features/sales/data/models/sale.dart';
import 'package:orvynt_starter/features/sales/data/repo/sales_repository.dart';
import 'package:orvynt_starter/features/sales/logic/basket.dart';
import 'package:orvynt_starter/features/sales/logic/sale_basket_cubit.dart';
import 'package:orvynt_starter/features/sales/ui/sale_result_view.dart';
import 'package:orvynt_starter/features/sales/ui/sale_screen.dart';
import 'package:orvynt_starter/features/today/data/repo/today_repository.dart';
import 'package:orvynt_starter/features/truck/data/current_truck.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_app.dart';

FakeReply api(RequestOptions o) {
  if (o.path == '/me/today') {
    return const FakeReply(200, {
      'day': '2026-11-22',
      'weekday': 0,
      'routes': <Object>[],
      'stops': <Object>[],
      'planned': 0,
      'visited': 0,
      'vehicle': {
        'id': 'v1',
        'code': 'CAM-01',
        'name': 'Hyundai HD35',
        'wilayaCode': 16,
      },
    });
  }
  if (o.path == '/pricing/preview') {
    return FakeReply(200, {
      'lines': [
        pricedLine(
          index: 0,
          qty: '10.000',
          lineHt: '9120.00',
          discountPct: '5.00',
          promotion: {'id': 'pr1', 'name': 'Ramadan -5 %'},
        ),
        pricedLine(index: 0, qty: '1.000', lineHt: '0.00', isFree: true),
        pricedLine(
          index: 1,
          qty: '6.000',
          lineHt: '252.00',
          unitId: 'u-pce',
          unitCode: 'PCE',
          unitPriceHt: '42.00',
        ),
      ],
      'totalHt': '9372.00',
      'totalTva': '1780.68',
      'totalTtc': '11152.68',
    });
  }
  if (o.path == '/packaging-types') {
    return const FakeReply(200, [
      {'id': 'pk1', 'name': 'Casier', 'depositValue': null, 'productCount': 3},
    ]);
  }
  return const FakeReply(404, {'code': 'NOT_FOUND', 'message': ''});
}

void main() {
  setUp(() {
    final client = ApiClient(
      dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
        ..httpClientAdapter = FakeAdapter(api),
    );
    getIt
      ..registerSingleton<ApiClient>(client)
      ..registerSingleton<SalesRepository>(SalesRepository(client))
      ..registerSingleton<CurrentTruck>(CurrentTruck(TodayRepository(client)));
  });
  tearDown(() => getIt.reset());

  final product = Product.fromJson(productJson());

  for (final locale in ['ar', 'fr']) {
    testWidgets(
      'basket with cartons, pièces and a promotion at 360 dp in $locale',
      (tester) async {
        await pumpScreen(
          tester,
          const SaleScreen(
            client: BasketClient(
              id: 'c1',
              code: 'CL-001',
              name: 'Supérette El Baraka Centre Commercial',
            ),
          ),
          locale: locale,
        );
        final cubit = tester
            .element(find.byType(ListView).first)
            .read<SaleBasketCubit>();
        cubit
          ..add(product, product.unitById('u-crt')!, Decimal.fromInt(10))
          ..add(product, product.unitById('u-pce')!, Decimal.fromInt(6));
        // Dio answers on real async I/O, outside the fake clock.
        await tester.runAsync(cubit.priceNow);
        await tester.pumpAndSettle();
        expect(find.byType(BasketLineTile), findsNWidgets(2));
        expect(find.textContaining('Ramadan'), findsOneWidget);
        expectNoOverflow(tester);
        await tester.drag(find.byType(ListView).first, const Offset(0, -900));
        await tester.pumpAndSettle();
        expectNoOverflow(tester);
      },
    );

    testWidgets('the saved BL at 360 dp in $locale', (tester) async {
      await pumpScreen(
        tester,
        SaleResultView(
          result: SaleResult.fromJson(saleResultJson()),
          onDone: () {},
        ),
        locale: locale,
      );
      expect(find.text('BL-2026-000130'), findsOneWidget);
      await tester.drag(find.byType(ListView).first, const Offset(0, -900));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.location_off_outlined), findsOneWidget);
      expectNoOverflow(tester);
    });
  }
}
