import 'package:get_it/get_it.dart';

import '../../features/auth/data/repo/auth_repository.dart';
import '../../features/today/data/repo/today_repository.dart';
import '../helpers/connectivity_services.dart';
import '../localization/localization_service.dart';
import '../network/api_client.dart';
import '../service/dio_generate.dart';
import '../session/session_cubit.dart';

final getIt = GetIt.instance;

Future<void> setupGetIt() async {
  getIt.registerLazySingleton<ConnectivityService>(() => ConnectivityService());
  getIt.registerLazySingleton<LocalizationService>(() => LocalizationService());

  // ── API (every repository on the one ApiClient) ─────────────────────────
  getIt.registerLazySingleton<ApiClient>(
    () => ApiClient(dio: DioGenerate.getDio()),
  );
  getIt.registerLazySingleton<AuthRepository>(() => AuthRepository(getIt()));
  getIt.registerLazySingleton<TodayRepository>(() => TodayRepository(getIt()));

  // ── App-wide state ──────────────────────────────────────────────────────
  getIt.registerLazySingleton<SessionCubit>(() => SessionCubit(getIt()));
}
