import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/components/widgets/buttons/theme_and_long.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/router/tab_routes.dart';
import 'package:orvynt_starter/core/session/session_state.dart';
import 'package:orvynt_starter/features/account/ui/account_screen.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_models.dart';
import 'package:orvynt_starter/features/assistant/data/assistant_repository.dart';
import 'package:orvynt_starter/features/assistant/logic/assistant_status_cubit.dart';

import '../../helpers/fake_adapter.dart';
import '../../helpers/pump_app.dart';

const available = AssistantStatus(available: true, provider: 'ANTHROPIC');

/// A session the test drives.
class DrivenSession extends FakeSession {
  DrivenSession(super.user);
  void set(SessionState state) => emit(state);
}

typedef MenuOf = List<MoreItem> Function(BuildContext context);

void main() {
  final roles = <String, (AuthUser, MenuOf)>{
    'seller': (seller(), sellerMenu),
    'livreur': (livreur(), livreurMenu),
    'supervisor': (supervisor(), supervisorMenu),
    'storekeeper': (storekeeper(), storekeeperMenu),
  };

  for (final MapEntry(key: role, value: (user, menu)) in roles.entries) {
    for (final locale in ['ar', 'fr']) {
      testWidgets('$role Plus shows the assistant in $locale', (tester) async {
        await pumpScreen(
          tester,
          Builder(builder: (context) => AccountScreen(menu: menu(context))),
          locale: locale,
          user: user,
          assistant: available,
        );
        expect(find.byIcon(Icons.auto_awesome_outlined), findsOneWidget);
        expect(find.byType(ThemeAndLangWidget), findsOneWidget);
        expectNoOverflow(tester);
      });
    }

    testWidgets('$role Plus hides the assistant when not available', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        Builder(builder: (context) => AccountScreen(menu: menu(context))),
        locale: 'fr',
        user: user,
      );
      expect(find.byIcon(Icons.auto_awesome_outlined), findsNothing);
    });
  }

  group('AssistantStatusCubit', () {
    late FakeAdapter adapter;
    late AssistantRepository repo;
    late FakeReply reply;

    setUp(() {
      reply = const FakeReply(200, {'available': true, 'provider': 'GEMINI'});
      adapter = FakeAdapter((_) => reply);
      repo = AssistantRepository(
        ApiClient(dio: Dio()..httpClientAdapter = adapter),
      );
    });

    test('reads the status once per signed-in user', () async {
      final session = DrivenSession(seller(features: [Feature.aiAssistant]));
      final cubit = AssistantStatusCubit(repo, session);
      await pumpEventQueue();
      expect(cubit.state.available, isTrue);
      expect(cubit.state.provider, 'GEMINI');
      // A refreshed /auth/me for the same user does not read it again.
      session.set(
        SessionState.signedIn(seller(features: [Feature.aiAssistant])),
      );
      await pumpEventQueue();
      expect(adapter.sent, hasLength(1));
      expect(adapter.sent.single.path, '/assistant/status');
      await cubit.close();
    });

    test('makes no call without AI_ASSISTANT', () async {
      final cubit = AssistantStatusCubit(repo, DrivenSession(seller()));
      await pumpEventQueue();
      expect(cubit.state.available, isFalse);
      expect(adapter.sent, isEmpty);
      await cubit.close();
    });

    test('resets on sign-out and hides on a failed call', () async {
      final session = DrivenSession(supervisor());
      final cubit = AssistantStatusCubit(repo, session);
      await pumpEventQueue();
      expect(cubit.state.available, isTrue);

      session.set(const SessionState.signedOut());
      await pumpEventQueue();
      expect(cubit.state.available, isFalse);

      reply = const FakeReply(500, {'code': 'INTERNAL_ERROR', 'message': 'x'});
      session.set(SessionState.signedIn(supervisor()));
      await pumpEventQueue();
      expect(cubit.state.available, isFalse);
      expect(adapter.sent, hasLength(2));
      await cubit.close();
    });
  });
}
