import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/localization/locale_cubit.dart';
import 'package:orvynt_starter/core/models/auth_user.dart';
import 'package:orvynt_starter/core/models/erp_codes.dart';
import 'package:orvynt_starter/core/network/api_client.dart';
import 'package:orvynt_starter/core/session/session_cubit.dart';
import 'package:orvynt_starter/core/session/session_state.dart';
import 'package:orvynt_starter/core/theme/app_theme_light.dart';
import 'package:orvynt_starter/core/theme/cubit/theme_cubit.dart';
import 'package:orvynt_starter/features/auth/data/repo/auth_repository.dart';

/// A seller of the demo tenant with the DISTRIBUTION modules.
AuthUser seller({
  List<String>? permissions,
  List<String> features = const [
    Feature.mobileApp,
    Feature.tournees,
    Feature.warehouses,
    Feature.geoCheck,
    Feature.promotions,
    Feature.packaging,
    Feature.incentives,
  ],
}) => AuthUser(
  id: 'seller-1',
  fullName: 'Karim Vendeur',
  role: Role.seller,
  tenantId: 't',
  tenantName: 'Grossiste Demo',
  edition: 'DISTRIBUTION',
  permissions:
      permissions ??
      const [
        Permission.clientsCreate,
        Permission.clientsEdit,
        Permission.salesCreate,
        Permission.paymentsCreate,
      ],
  features: features,
);

/// A livreur of the demo tenant: VIEW_ALL only by default (he collects
/// through the delivery); [permissions] adds grants.
AuthUser livreur({
  List<String> permissions = const [],
  List<String> features = const [
    Feature.mobileApp,
    Feature.tournees,
    Feature.warehouses,
    Feature.geoCheck,
    Feature.packaging,
  ],
}) => AuthUser(
  id: 'livreur-1',
  fullName: 'Samir Livreur',
  role: Role.livreur,
  tenantId: 't',
  tenantName: 'Grossiste Demo',
  edition: 'DISTRIBUTION',
  permissions: permissions,
  features: features,
);

/// A session already signed in as [user]; never touches storage or network.
class FakeSession extends SessionCubit {
  FakeSession(AuthUser user) : super(AuthRepository(ApiClient(dio: Dio()))) {
    emit(SessionState.signedIn(user));
  }

  @override
  Future<void> restore() async {}

  @override
  Future<void> refreshUser() async {}
}

/// Phone sizes of docs/ui.md.
const phone360 = Size(360, 640);

/// Pumps [child] like the app does (theme, ScreenUtil, ar/fr/en strings,
/// RTL for ar) on a 360 × 640 screen, signed in as [user].
Future<void> pumpScreen(
  WidgetTester tester,
  Widget child, {
  String locale = 'ar',
  AuthUser? user,
  Size size = phone360,
}) async {
  // The bundle caches each string file's Future in the zone of the test that
  // first loaded it; a later test would await a Future that never completes.
  rootBundle.clear();
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MultiBlocProvider(
      providers: [
        BlocProvider<SessionCubit>(
          create: (_) => FakeSession(user ?? seller()),
        ),
        BlocProvider(create: (_) => ThemeCubit(ThemeMode.light)),
        BlocProvider(create: (_) => LocaleCubit(Locale(locale))),
      ],
      child: ScreenUtilInit(
        designSize: const Size(375, 812),
        minTextAdapt: true,
        builder: (_, _) => MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: appThemeLight,
          locale: Locale(locale),
          supportedLocales: const [Locale('ar'), Locale('fr'), Locale('en')],
          localizationsDelegates: const [
            AppLocalizationsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: child,
        ),
      ),
    ),
  );
  // Strings load from the asset bundle on real async I/O, outside the fake
  // clock: give it real time, then settle the frames.
  for (var i = 0; i < 20; i++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pump();
    if (find.byType(Scaffold).evaluate().isNotEmpty) break;
  }
  await tester.pumpAndSettle();
}

/// Fails when a widget overflowed (yellow-black stripes) during the test.
void expectNoOverflow(WidgetTester tester) {
  final error = tester.takeException();
  expect(error, isNull, reason: 'layout error: $error');
}
