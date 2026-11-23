import 'package:get_it/get_it.dart';

import '../../features/assistant/data/assistant_repository.dart';
import '../../features/assistant/logic/assistant_status_cubit.dart';
import '../../features/auth/data/repo/auth_repository.dart';
import '../../features/catalog/data/repo/catalog_repository.dart';
import '../../features/controls/data/controls_repository.dart';
import '../../features/objectives/data/objectives.dart';
import '../../features/inventory/data/inventories_repository.dart';
import '../../features/stock_transfers/data/stock_transfers_repository.dart';
import '../../features/team/data/team_repository.dart';
import '../../features/team_orders/data/team_orders_repository.dart';
import '../../features/delivery/data/deliveries_repository.dart';
import '../../features/orders/data/repo/orders_repository.dart';
import '../../features/payments/data/repo/payments_repository.dart';
import '../../features/sales/data/repo/sales_repository.dart';
import '../../features/truck/data/current_truck.dart';
import '../../features/truck/data/truck_repository.dart';
import '../../features/visits/data/visits_repository.dart';
import '../../features/clients/data/repo/clients_repository.dart';
import '../../features/today/data/repo/today_repository.dart';
import '../geo/geo_service.dart';
import '../helpers/connectivity_services.dart';
import '../localization/localization_service.dart';
import '../map/client_map_repository.dart';
import '../network/api_client.dart';
import '../service/dio_generate.dart';
import '../session/session_cubit.dart';

final getIt = GetIt.instance;

Future<void> setupGetIt() async {
  getIt.registerLazySingleton<ConnectivityService>(() => ConnectivityService());
  getIt.registerLazySingleton<LocalizationService>(() => LocalizationService());
  getIt.registerLazySingleton<GeoService>(() => DeviceGeoService());

  // ── API (every repository on the one ApiClient) ─────────────────────────
  getIt.registerLazySingleton<ApiClient>(
    () => ApiClient(dio: DioGenerate.getDio()),
  );
  getIt.registerLazySingleton<AuthRepository>(() => AuthRepository(getIt()));
  getIt.registerLazySingleton<TodayRepository>(() => TodayRepository(getIt()));
  getIt.registerLazySingleton<ClientsRepository>(
    () => ClientsRepository(getIt()),
  );
  getIt.registerLazySingleton<CatalogRepository>(
    () => CatalogRepository(getIt()),
  );
  getIt.registerLazySingleton<SalesRepository>(() => SalesRepository(getIt()));
  getIt.registerLazySingleton<CurrentTruck>(() => CurrentTruck(getIt()));
  getIt.registerLazySingleton<OrdersRepository>(
    () => OrdersRepository(getIt()),
  );
  getIt.registerLazySingleton<DeliveriesRepository>(
    () => DeliveriesRepository(getIt(), getIt()),
  );

  getIt.registerLazySingleton<PaymentsRepository>(
    () => PaymentsRepository(getIt()),
  );

  getIt.registerLazySingleton<VisitsRepository>(
    () => VisitsRepository(getIt()),
  );

  getIt.registerLazySingleton<TruckRepository>(() => TruckRepository(getIt()));

  getIt.registerLazySingleton<TeamRepository>(() => TeamRepository(getIt()));
  getIt.registerLazySingleton<StockTransfersRepository>(
    () => StockTransfersRepository(getIt()),
  );
  getIt.registerLazySingleton<InventoriesRepository>(
    () => InventoriesRepository(getIt()),
  );
  getIt.registerLazySingleton<ClientMapRepository>(
    () => ClientMapRepository(getIt()),
  );
  getIt.registerLazySingleton<ControlsRepository>(
    () => ControlsRepository(getIt()),
  );
  getIt.registerLazySingleton<TeamOrdersRepository>(
    () => TeamOrdersRepository(getIt(), getIt(), getIt()),
  );
  getIt.registerLazySingleton<ObjectivesRepository>(
    () => ObjectivesRepository(getIt()),
  );

  // ── App-wide state ──────────────────────────────────────────────────────
  getIt.registerLazySingleton<SessionCubit>(() => SessionCubit(getIt()));
  getIt.registerLazySingleton<AssistantRepository>(
    () => AssistantRepository(getIt()),
  );
  getIt.registerLazySingleton<AssistantStatusCubit>(
    () => AssistantStatusCubit(getIt(), getIt()),
  );
}
