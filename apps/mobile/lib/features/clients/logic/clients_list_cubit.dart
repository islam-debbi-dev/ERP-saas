import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/geo/geo_fix.dart';
import '../../../core/paging/paged_cubit.dart';
import '../data/models/client.dart';
import '../data/repo/clients_repository.dart';

/// Filters of the client list.
class ClientFilter {
  const ClientFilter({this.search = '', this.debtorsOnly = false, this.near});

  final String search;
  final bool debtorsOnly;

  /// "Près de moi": the position the list is sorted around; null = off.
  final GeoFix? near;

  ClientFilter copyWith({
    String? search,
    bool? debtorsOnly,
    GeoFix? near,
    bool clearNear = false,
  }) => ClientFilter(
    search: search ?? this.search,
    debtorsOnly: debtorsOnly ?? this.debtorsOnly,
    near: clearNear ? null : (near ?? this.near),
  );
}

/// The client list: search, debtors, near me. Each filter change reloads from
/// the first page; stale pages are dropped by [PagedCubit].
class ClientsListCubit extends PagedCubit<ClientRow> {
  ClientsListCubit(this._repo) : super((_) => throw StateError('not started'));

  final ClientsRepository _repo;
  ClientFilter filter = const ClientFilter();

  Future<void> start() => apply(filter);

  Future<void> apply(ClientFilter next) {
    filter = next;
    final f = next;
    return reset(
      (cursor) => f.near != null
          ? _repo.nearby(f.near!, search: f.search, debtorsOnly: f.debtorsOnly)
          : _repo.list(
              search: f.search,
              debtorsOnly: f.debtorsOnly,
              cursor: cursor,
            ),
    );
  }

  Future<void> search(String text) => apply(filter.copyWith(search: text));

  Future<void> toggleDebtors() =>
      apply(filter.copyWith(debtorsOnly: !filter.debtorsOnly));

  Future<void> nearMe(GeoFix? fix) => fix == null
      ? apply(filter.copyWith(clearNear: true))
      : apply(filter.copyWith(near: fix));
}

/// Satisfies `BlocProvider` lookups by the paged base type too.
typedef ClientsListState = PagedState<ClientRow>;
typedef ClientsListBuilder = BlocBuilder<ClientsListCubit, ClientsListState>;
