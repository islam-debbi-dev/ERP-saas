import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/session/session_state.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';
import 'package:orvynt_starter/features/splash/ui/splash_screen.dart';

/// Session that never touches secure storage or the network.
class _SignedOutSession extends SessionCubit {
  _SignedOutSession() : super(AuthRepository(ApiClient(dio: Dio())));

  @override
  Future<void> restore() async => emit(const SessionState.signedOut());
}

void main() {
  testWidgets('splash screen renders and animates without crashing', (
    tester,
  ) async {
    await tester.pumpWidget(
      BlocProvider<SessionCubit>(
        create: (_) => _SignedOutSession(),
        child: const MaterialApp(home: LogoSplashScreen()),
      ),
    );

    expect(find.byType(LogoSplashScreen), findsOneWidget);

    // Advance the intro animation; it must not throw (the completion callback
    // navigates through go_router, which is not mounted here, so stop before).
    await tester.pump(const Duration(seconds: 2));
    expect(find.byType(LogoSplashScreen), findsOneWidget);
  });
}
