import '../../../core/network/api_result.dart';
import '../../../core/paging/load_cubit.dart';
import '../../sales/data/models/sale_summary.dart';
import '../data/models/client.dart';
import '../data/repo/clients_repository.dart';

/// Everything the client screen shows, loaded together.
class ClientDetail {
  const ClientDetail({
    required this.client,
    this.unpaid = const [],
    this.lastSales = const [],
  });

  final Client client;
  final List<UnpaidDocument> unpaid;
  final List<SaleSummary> lastSales;
}

/// The client, his unpaid documents and his last sales, in parallel. The
/// client is required; the two lists show empty when their call fails (the
/// seller may lack the right to one of them).
class ClientDetailCubit extends LoadCubit<ClientDetail> {
  ClientDetailCubit(ClientsRepository repo, String clientId)
    : super(() => _load(repo, clientId));

  static Future<ApiResult<ClientDetail>> _load(
    ClientsRepository repo,
    String id,
  ) async {
    final results = await Future.wait([
      repo.get(id),
      repo.unpaidDocuments(id),
      repo.lastSales(id),
    ]);
    final client = results[0] as ApiResult<Client>;
    final unpaid = results[1] as ApiResult<List<UnpaidDocument>>;
    final sales = results[2] as ApiResult<List<SaleSummary>>;
    switch (client) {
      case Failure(:final error):
        return ApiResult.failure(error);
      case Success(:final data):
        return ApiResult.success(
          ClientDetail(
            client: data,
            unpaid: unpaid is Success<List<UnpaidDocument>> ? unpaid.data : [],
            lastSales: sales is Success<List<SaleSummary>> ? sales.data : [],
          ),
        );
    }
  }
}
