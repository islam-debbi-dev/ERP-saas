import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/locations/algeria_locations.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/features/clients/data/repo/clients_repository.dart';
import 'package:orvynt_starter/features/clients/ui/new_client_screen.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

late AlgeriaLocations locations;
late FakeAdapter api;
String refusal = 'COMMUNE_UNDER_REVIEW';

Future<void> open(WidgetTester tester, {String locale = 'fr'}) async {
  await pumpScreen(tester, const NewClientScreen(), locale: locale);
  // The asset is read on real I/O, outside the test's fake clock.
  locations = (await tester.runAsync(AlgeriaLocations.load))!;
}

Finder field(String name) => find.byKey(Key('pick-$name'));

Future<void> tapField(WidgetTester tester, String name) async {
  await tester.ensureVisible(field(name));
  await tester.pumpAndSettle();
  await tester.tap(field(name));
  await tester.pumpAndSettle();
}

/// Types in the open sheet and waits out the search debounce.
Future<void> search(WidgetTester tester, String text) async {
  await tester.enterText(
    find.descendant(
      of: find.byType(BottomSheet),
      matching: find.byType(TextField),
    ),
    text,
  );
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pumpAndSettle();
}

Future<void> pick(
  WidgetTester tester,
  String name,
  String query,
  String id,
) async {
  await tapField(tester, name);
  await search(tester, query);
  await tester.tap(find.byKey(Key(id)));
  await tester.pumpAndSettle();
}

/// The text shown inside a closed field.
Finder shown(String name, String text) =>
    find.descendant(of: field(name), matching: find.text(text));

bool enabled(WidgetTester tester, String name) => tester
    .widget<InputDecorator>(
      find.descendant(of: field(name), matching: find.byType(InputDecorator)),
    )
    .decoration
    .enabled;

Future<Map<String, dynamic>> save(WidgetTester tester) async {
  final fields = find.byType(TextFormField);
  await tester.ensureVisible(fields.at(0));
  await tester.enterText(fields.at(0), 'CL-9');
  await tester.enterText(fields.at(1), 'Superette');
  await tester.tap(find.text('Enregistrer'));
  await tester.pumpAndSettle();
  return api.sent.single.body! as Map<String, dynamic>;
}

/// A commune of [wilaya] with a daïra, and that daïra.
(Commune, Daira) withDaira(int wilaya, [int skip = 0]) {
  final commune = locations
      .communesOf(wilaya)
      .where((c) => c.dairaKey != null)
      .skip(skip)
      .first;
  return (
    commune,
    locations.dairas.singleWhere((d) => d.key == commune.dairaKey),
  );
}

void main() {
  setUp(() {
    api = FakeAdapter(
      (RequestOptions o) =>
          FakeReply(422, {'code': refusal, 'message': 'server text'}),
    );
    final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))
      ..httpClientAdapter = api;
    getIt.registerSingleton<ClientsRepository>(
      ClientsRepository(ApiClient(dio: dio)),
    );
  });
  tearDown(() => getIt.reset());

  testWidgets('daïra and commune wait for the wilaya', (tester) async {
    await open(tester);
    expect(enabled(tester, 'wilaya'), isTrue);
    expect(enabled(tester, 'daira'), isFalse);
    expect(enabled(tester, 'commune'), isFalse);
    await tapField(tester, 'commune');
    expect(find.byType(BottomSheet), findsNothing);

    await pick(tester, 'wilaya', 'msila', 'wilaya-28');
    expect(shown('wilaya', "28 · M'Sila"), findsOneWidget);
    expect(enabled(tester, 'daira'), isTrue);
    expect(enabled(tester, 'commune'), isTrue);
  });

  testWidgets('another wilaya clears daïra and commune, the same one keeps', (
    tester,
  ) async {
    await open(tester);
    await pick(tester, 'wilaya', '16', 'wilaya-16');
    final (commune, daira) = withDaira(16);
    await pick(tester, 'daira', daira.fr, 'daira-${daira.key}');
    await pick(tester, 'commune', commune.fr, 'commune-${commune.code}');
    expect(shown('daira', daira.fr), findsOneWidget);
    expect(shown('commune', commune.fr), findsOneWidget);

    await pick(tester, 'wilaya', '16', 'wilaya-16');
    expect(shown('commune', commune.fr), findsOneWidget);

    await pick(tester, 'wilaya', 'oran', 'wilaya-31');
    expect(shown('daira', daira.fr), findsNothing);
    expect(shown('commune', commune.fr), findsNothing);
  });

  testWidgets('another daïra clears a commune outside it', (tester) async {
    await open(tester);
    await pick(tester, 'wilaya', '16', 'wilaya-16');
    final (commune, daira) = withDaira(16);
    await pick(tester, 'commune', commune.fr, 'commune-${commune.code}');
    // Picking a commune does not need a daïra.
    expect(shown('commune', commune.fr), findsOneWidget);

    await pick(tester, 'daira', daira.fr, 'daira-${daira.key}');
    expect(shown('commune', commune.fr), findsOneWidget);

    final other = locations.dairasOf(16).firstWhere((d) => d.key != daira.key);
    await pick(tester, 'daira', other.fr, 'daira-${other.key}');
    expect(shown('commune', commune.fr), findsNothing);
  });

  testWidgets('under a daïra, a commune without one is still reachable', (
    tester,
  ) async {
    await open(tester);
    await pick(tester, 'wilaya', 'ouargla', 'wilaya-30');
    final (_, daira) = withDaira(30);
    await pick(tester, 'daira', daira.fr, 'daira-${daira.key}');

    await tapField(tester, 'commune');
    await search(tester, 'rouissat');
    expect(find.byKey(const Key('commune-3005')), findsNothing);
    await tester.tap(find.byKey(const Key('show-all')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('commune-3005')));
    await tester.pumpAndSettle();

    expect(shown('commune', 'Rouissat'), findsOneWidget);
    expect(shown('daira', daira.fr), findsNothing);
  });

  testWidgets('searches in Arabic and French whatever the app language', (
    tester,
  ) async {
    await open(tester, locale: 'ar');
    await tapField(tester, 'wilaya');
    // Typed without the hamza.
    await search(tester, 'الاغواط');
    expect(find.byKey(const Key('wilaya-3')), findsOneWidget);
    expect(find.text('03 · الأغواط'), findsOneWidget);
    // Typed in French, without accents.
    await search(tester, 'bejaia');
    expect(find.byKey(const Key('wilaya-6')), findsOneWidget);
    expect(find.byKey(const Key('wilaya-3')), findsNothing);
    await search(tester, 'zzzz');
    expect(find.text('لا توجد نتائج'), findsOneWidget);
    await search(tester, 'bejaia');
    await tester.tap(find.byKey(const Key('wilaya-6')));
    await tester.pumpAndSettle();

    final (commune, _) = withDaira(6);
    for (final query in [commune.ar, commune.fr.toUpperCase()]) {
      await tapField(tester, 'commune');
      await search(tester, query);
      expect(find.byKey(Key('commune-${commune.code}')), findsOneWidget);
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
    }
  });

  testWidgets('communes of wilayas 59 to 69 can be picked', (tester) async {
    await open(tester);
    await pick(tester, 'wilaya', 'aflou', 'wilaya-59');
    final commune = locations.communesOf(59).first;

    await tapField(tester, 'commune');
    await search(tester, commune.fr);
    final row = find.byKey(Key('commune-${commune.code}'));
    expect(tester.widget<ListTile>(row).enabled, isTrue);
    expect(find.text('En cours de vérification'), findsNothing);
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);

    final body = await save(tester);
    expect(body['wilayaCode'], 59);
    expect(body['wilaya'], 'Aflou');
    expect(body['communeCode'], commune.code);
    expect(body['commune'], commune.fr);
  });

  testWidgets('the body carries the codes and the French names', (
    tester,
  ) async {
    await open(tester);
    await pick(tester, 'wilaya', '16', 'wilaya-16');
    final (commune, daira) = withDaira(16);
    await pick(tester, 'daira', daira.fr, 'daira-${daira.key}');
    await pick(tester, 'commune', commune.fr, 'commune-${commune.code}');

    final body = await save(tester);
    expect(body['wilayaCode'], 16);
    expect(body['communeCode'], commune.code);
    expect(body['wilaya'], 'Alger');
    expect(body['commune'], commune.fr);
    expect(body.containsKey('daira'), isFalse);
  });

  testWidgets('in Arabic the body still carries the French names', (
    tester,
  ) async {
    await open(tester, locale: 'ar');
    await pick(tester, 'wilaya', '16', 'wilaya-16');
    final (commune, _) = withDaira(16);
    await pick(tester, 'commune', commune.ar, 'commune-${commune.code}');
    expect(shown('commune', commune.ar), findsOneWidget);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'CL-9');
    await tester.enterText(fields.at(1), 'Superette');
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();
    final body = api.sent.single.body! as Map<String, dynamic>;
    expect(body['wilaya'], 'Alger');
    expect(body['commune'], commune.fr);
  });

  testWidgets('nothing picked, or cleared, sends no code', (tester) async {
    await open(tester);
    await pick(tester, 'wilaya', '16', 'wilaya-16');
    await tester.tap(
      find.descendant(of: field('wilaya'), matching: find.byType(IconButton)),
    );
    await tester.pumpAndSettle();
    expect(enabled(tester, 'commune'), isFalse);

    final body = await save(tester);
    expect(body.containsKey('wilayaCode'), isFalse);
    expect(body.containsKey('communeCode'), isFalse);
    expect(body['wilaya'], '');
    expect(body['commune'], '');
  });

  for (final (code, message) in [
    ('COMMUNE_UNKNOWN', "Cette commune n'est pas dans la liste officielle."),
    (
      'COMMUNE_WILAYA_MISMATCH',
      "Cette commune n'appartient pas à la wilaya choisie.",
    ),
    (
      'COMMUNE_UNDER_REVIEW',
      'Cette commune est encore en cours de vérification. '
          'Choisissez seulement la wilaya.',
    ),
  ]) {
    testWidgets('$code is shown translated', (tester) async {
      refusal = code;
      await open(tester);
      await save(tester);
      expect(find.text(message), findsOneWidget);
    });
  }

  testWidgets('360 dp in Arabic: form and lists fit', (tester) async {
    await open(tester, locale: 'ar');
    expectNoOverflow(tester);
    // The longest names: wilaya 69, then its list of communes.
    await pick(tester, 'wilaya', '69', 'wilaya-69');
    expectNoOverflow(tester);
    await tapField(tester, 'commune');
    expectNoOverflow(tester);
    // With the keyboard open.
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pumpAndSettle();
    expectNoOverflow(tester);
    tester.view.resetViewInsets();
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();

    await pick(tester, 'wilaya', '16', 'wilaya-16');
    final (commune, daira) = withDaira(16);
    await pick(tester, 'daira', daira.fr, 'daira-${daira.key}');
    await pick(tester, 'commune', commune.fr, 'commune-${commune.code}');
    expectNoOverflow(tester);
    // Every box is a big target.
    for (final name in ['wilaya', 'daira', 'commune']) {
      expect(tester.getSize(field(name)).height, greaterThanOrEqualTo(48));
    }
  });
}
