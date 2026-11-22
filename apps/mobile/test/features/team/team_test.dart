import 'package:decimal/decimal.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/design/design.dart';
import 'package:orvynt_starter/core/di/dependency_injection.dart';
import 'package:orvynt_starter/core/network/api_result.dart';
import 'package:orvynt_starter/core/network/idempotency_key.dart';
import 'package:orvynt_starter/features/auth/ui/widgets/form_error_banner.dart';
import 'package:orvynt_starter/features/team/data/team_models.dart';
import 'package:orvynt_starter/features/team/data/team_repository.dart';
import 'package:orvynt_starter/features/team/logic/team_cubits.dart';
import 'package:orvynt_starter/features/team/ui/cash_form_screen.dart';
import 'package:orvynt_starter/features/team/ui/driver_screen.dart';
import 'package:orvynt_starter/features/team/ui/member_day_screen.dart';
import 'package:orvynt_starter/features/team/ui/team_screen.dart';
import 'package:orvynt_starter/features/team/ui/team_widgets.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';
import 'team_fixtures.dart';

final _today = DateTime.utc(2026, 11, 22, 10);

SellerDay member(int i) => SellerDay.fromJson(teamJson()[i]);

void main() {
  group('team models', () {
    test('a closed day keeps the server écart; a correction replaces it', () {
      final s = SellerSession.fromJson(
        sessionJson(
          status: 'CLOSED',
          handed: '15000.00',
          ecart: '-500.00',
          adjustments: [
            {
              'id': 'a1',
              'handedCash': '15500.00',
              'ecart': '0.00',
              'note': 'Recompté',
              'by': {'id': 'sup-1', 'fullName': 'Nadia'},
              'at': '2026-11-22T18:00:00.000Z',
            },
          ],
        ),
      );
      expect(s.ecart, Decimal.parse('-500'));
      expect(s.currentEcart, Decimal.zero);
      expect(s.currentHanded, Decimal.parse('15500'));
    });

    test('only live trucks are offered', () {
      final list = TruckOption.listFrom([
        truckJson('v1', 'A'),
        {...truckJson('v2', 'B'), 'active': false},
        {...truckJson('d1', 'DEPOT'), 'type': 'MAIN'},
      ]);
      expect(list.map((t) => t.id), ['v1']);
    });
  });

  group('team scope', () {
    test('a member outside the API team is never read by his id', () async {
      final api = teamApi();
      final r = await TeamRepository(
        apiWith(api),
      ).member('other', '2026-11-22');
      final data = (r as Success<MemberDay>).data;
      expect(data.inTeam, isFalse);
      expect(api.sent.map((s) => s.path), ['/seller-sessions']);
      expect(api.sent.any((s) => s.path.contains('other')), isFalse);
    });

    test('a member of the team gets his sales of the day', () async {
      final api = teamApi();
      final r = await TeamRepository(apiWith(api)).member('u1', '2026-11-22');
      final data = (r as Success<MemberDay>).data;
      expect(data.day!.seller.fullName, 'Karim Vendeur');
      expect(data.sales!.count, 7);
      expect(data.sales!.netTtc, Decimal.parse('48200'));
    });
  });

  group('clôture', () {
    test(
      'close sends the cash as a string and the same key after a timeout',
      () async {
        var calls = 0;
        final api = teamApi(
          onPost: (o) {
            calls++;
            if (calls == 1) {
              return const FakeReply.fail(DioExceptionType.receiveTimeout);
            }
            return FakeReply(200, {
              'session': sessionJson(
                status: 'CLOSED',
                handed: '15000.00',
                ecart: '-500.00',
              ),
              'vehicleStock': <Object>[],
            });
          },
        );
        final cubit = CashFormCubit(
          TeamRepository(apiWith(api)),
          mode: CashFormMode.close,
          session: member(0).session!,
          expected: Decimal.parse('15500'),
        );
        cubit.setHanded(Decimal.parse('15000'));
        expect(cubit.ecartPreview, Decimal.parse('-500'));
        expect(await cubit.submit(), isFalse);
        expect(cubit.state.error, isNotNull);
        expect(await cubit.submit(), isTrue);
        final posts = api.sent.where((s) => s.method == 'POST').toList();
        expect(posts, hasLength(2));
        expect(posts.first.path, '/seller-sessions/s1/close');
        expect((posts.first.body! as Map)['handedCash'], '15000.00');
        expect(
          posts[0].headers[IdempotencyKey.header],
          posts[1].headers[IdempotencyKey.header],
        );
        expect(cubit.state.closed!.session.ecart, Decimal.parse('-500'));
        await cubit.close();
      },
    );

    test('close needs a count; a correction needs a note', () async {
      final repo = TeamRepository(apiWith(teamApi()));
      final close = CashFormCubit(
        repo,
        mode: CashFormMode.close,
        session: member(0).session!,
        expected: Decimal.parse('15500'),
      );
      expect(await close.submit(), isFalse);
      expect(close.errors, ['team.error_handed']);
      final adjust = CashFormCubit(
        repo,
        mode: CashFormMode.adjust,
        session: member(1).session!,
        expected: Decimal.parse('15500'),
      );
      expect(await adjust.submit(), isFalse);
      expect(adjust.errors, ['team.error_note']);
      adjust.setNote('Recompté le soir');
      expect(adjust.errors, isEmpty);
      await close.close();
      await adjust.close();
    });

    test('a correction without a new count sends handedCash null', () async {
      final api = teamApi(
        onPost: (o) => FakeReply(
          201,
          sessionJson(status: 'CLOSED', handed: '15000.00', ecart: '-500.00'),
        ),
      );
      final cubit = CashFormCubit(
        TeamRepository(apiWith(api)),
        mode: CashFormMode.adjust,
        session: member(1).session!,
        expected: Decimal.parse('15500'),
      );
      cubit.setNote('Billet oublié');
      expect(await cubit.submit(), isTrue);
      final body = api.sent.single.body! as Map;
      expect(api.sent.single.path, '/seller-sessions/s2/adjust');
      expect(body['handedCash'], isNull);
      expect(body['note'], 'Billet oublié');
      await cubit.close();
    });
  });

  group('driver of today', () {
    test(
      'a refusal keeps the key of that truck; another truck gets a new one',
      () async {
        var refuse = true;
        final api = teamApi(
          onPost: (o) {
            if (refuse) {
              return const FakeReply(409, {
                'code': 'SESSION_OPEN_ON_VEHICLE',
                'message': 'open',
              });
            }
            return const FakeReply(200, {
              'vehicleId': 'v3',
              'driver': {'id': 'u1', 'fullName': 'Karim Vendeur'},
              'previousDriver': null,
              'freedVehicle': {
                'id': 'v1',
                'name': 'Isuzu',
                'code': 'VAN-16 MXT 01',
              },
            });
          },
        );
        final cubit = DriverCubit(
          TeamRepository(apiWith(api)),
          member: member(0),
        );
        await cubit.load();
        final v3 = cubit.state.trucks!.firstWhere((t) => t.id == 'v3');
        final v2 = cubit.state.trucks!.firstWhere((t) => t.id == 'v2');
        expect(await cubit.assign(v3), isNull);
        expect(cubit.state.error!.code, 'SESSION_OPEN_ON_VEHICLE');
        refuse = false;
        expect(await cubit.assign(v3), isNotNull);
        await cubit.assign(v2);
        final posts = api.sent.where((s) => s.method == 'POST').toList();
        expect(posts.map((p) => p.path), [
          '/warehouses/v3/driver',
          '/warehouses/v3/driver',
          '/warehouses/v2/driver',
        ]);
        expect((posts.first.body! as Map)['userId'], 'u1');
        final keys = posts
            .map((p) => p.headers[IdempotencyKey.header])
            .toList();
        expect(keys[0], keys[1]);
        expect(keys[2], isNot(keys[1]));
        // His own truck is listed first.
        expect(cubit.state.trucks!.first.id, 'v1');
        await cubit.close();
      },
    );
  });

  group('screens at 360 dp', () {
    late FakeAdapter api;
    void register(FakeAdapter a) {
      api = a;
      getIt.registerSingleton<TeamRepository>(TeamRepository(apiWith(a)));
    }

    tearDown(getIt.reset);

    for (final locale in ['ar', 'fr']) {
      testWidgets('team list in $locale', (tester) async {
        register(teamApi());
        await pumpScreen(
          tester,
          TeamScreen(
            clock: () => _today,
            onOpenMember: (_, _, _) async => null,
          ),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byType(SellerDayCard), findsNWidgets(3));
        expect(find.text('Karim Vendeur'), findsOneWidget);
        expect(api.sent.first.query['date'], '2026-11-22');
        expectNoOverflow(tester);
        // An earlier day reloads the team of that day.
        await tester.tap(find.byType(IconButton).first);
        await tester.pumpAndSettle();
        expect(api.sent.last.query['date'], '2026-11-21');
        expectNoOverflow(tester);
      });

      testWidgets('open day with its actions in $locale', (tester) async {
        register(teamApi());
        await pumpScreen(
          tester,
          const MemberDayScreen(
            sellerId: 'u1',
            date: '2026-11-22',
            today: '2026-11-22',
          ),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byType(DayStatusChip), findsOneWidget);
        expect(find.byIcon(Icons.lock_clock_outlined), findsOneWidget);
        await tester.scrollUntilVisible(
          find.byIcon(Icons.swap_horiz_rounded),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.byIcon(Icons.swap_horiz_rounded), findsOneWidget);
        expectNoOverflow(tester);
      });

      testWidgets('closed day shows the écart in $locale', (tester) async {
        register(teamApi());
        await pumpScreen(
          tester,
          const MemberDayScreen(
            sellerId: 'u2',
            date: '2026-11-22',
            today: '2026-11-22',
          ),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byIcon(Icons.edit_note_outlined), findsOneWidget);
        expect(find.textContaining('500,00'), findsWidgets);
        expectNoOverflow(tester);
      });

      testWidgets('a day not opened, on an earlier day, in $locale', (
        tester,
      ) async {
        register(teamApi());
        await pumpScreen(
          tester,
          const MemberDayScreen(
            sellerId: 'u3',
            date: '2026-11-22',
            today: '2026-11-23',
          ),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byIcon(Icons.play_circle_outline), findsOneWidget);
        // The truck changes only today.
        expect(find.byIcon(Icons.swap_horiz_rounded), findsNothing);
        expectNoOverflow(tester);
      });

      testWidgets('another supervisor\'s seller by deep link in $locale', (
        tester,
      ) async {
        register(teamApi());
        await pumpScreen(
          tester,
          const MemberDayScreen(sellerId: 'other', date: '2026-11-22'),
          locale: locale,
          user: supervisor(),
        );
        expect(find.byIcon(Icons.person_off_outlined), findsOneWidget);
        expect(find.byType(AppButton), findsNothing);
        expect(api.sent.map((s) => s.path), ['/seller-sessions']);
        expectNoOverflow(tester);
      });

      testWidgets('close form, then the server\'s écart, in $locale', (
        tester,
      ) async {
        register(
          teamApi(
            onPost: (o) => FakeReply(200, {
              'session': sessionJson(
                status: 'CLOSED',
                handed: '15000.00',
                ecart: '-500.00',
              ),
              'vehicleStock': [
                {
                  'productId': 'p1',
                  'reference': 'HUI-5L',
                  'designation': 'Huile de table Elio bouteille 5 litres',
                  'unitId': 'u',
                  'unitCode': 'BTL',
                  'qtyBase': '12.000',
                },
              ],
            }),
          ),
        );
        await pumpScreen(
          tester,
          CashFormScreen(member: member(0), mode: CashFormMode.close),
          locale: locale,
          user: supervisor(),
        );
        await tester.enterText(find.byType(TextField).first, '15000');
        await tester.pumpAndSettle();
        expectNoOverflow(tester);
        await tester.tap(find.byIcon(Icons.check_circle_outline));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsOneWidget);
        await tester.tap(find.byType(FilledButton));
        await tester.pumpAndSettle();
        expect(
          find.text('Huile de table Elio bouteille 5 litres'),
          findsOneWidget,
        );
        final post = api.sent.singleWhere((s) => s.method == 'POST');
        expect((post.body! as Map)['handedCash'], '15000.00');
        expectNoOverflow(tester);
      });

      testWidgets('driver change refused while the day is open in $locale', (
        tester,
      ) async {
        register(
          teamApi(
            onPost: (o) => const FakeReply(409, {
              'code': 'SESSION_OPEN_ON_VEHICLE',
              'message': 'open',
            }),
          ),
        );
        await pumpScreen(
          tester,
          DriverScreen(member: member(0)),
          locale: locale,
          user: supervisor(),
        );
        expect(find.text('CAM-16 LIV 02 · Isuzu NPR'), findsOneWidget);
        await tester.tap(find.text('VAN-16 MXT 03 · Isuzu NPR'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsOneWidget);
        await tester.tap(find.byType(FilledButton));
        await tester.pumpAndSettle();
        expect(find.byType(FormErrorBanner), findsOneWidget);
        expect(find.byType(AlertDialog), findsNothing);
        expectNoOverflow(tester);
      });
    }
  });
}
