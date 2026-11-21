import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/session/session_state.dart';
import 'package:orvynt_starter/features/account/data/repo/account_repository.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';
import 'package:orvynt_starter/features/splash/ui/splash_screen.dart';

/// Session that never touches secure storage or the network.
class _GuestSession extends SessionCubit {
  _GuestSession()
    : super(
        AuthRepository(ApiClient(dio: Dio())),
        AccountRepository(ApiClient(dio: Dio())),
      );

  @override
  Future<void> restore() async => emit(const SessionState.guest());
}

void main() {
  testWidgets('splash screen renders and animates without crashing',
      (tester) async {
    await tester.pumpWidget(
      BlocProvider<SessionCubit>(
        create: (_) => _GuestSession(),
        child: const MaterialApp(home: LogoSplashScreen()),
      ),
    );

    expect(find.byType(LogoSplashScreen), findsOneWidget);
    expect(find.byType(CustomPaint), findsWidgets);

    // Advance the 3s intro animation. It must complete without throwing
    // (the completion callback only fires navigation via go_router, which is
    // not mounted here, so we stop before the whole sequence ends).
    await tester.pump(const Duration(seconds: 2));
    expect(find.byType(LogoSplashScreen), findsOneWidget);
  });
}
