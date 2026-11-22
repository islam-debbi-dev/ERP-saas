import '../../../core/models/json_converters.dart';
import '../../../core/network/api_result.dart';
import '../../today/data/repo/today_repository.dart';

/// The truck the user drives today (a `Warehouse` of type VEHICLE), from
/// `GET /me/today`. A van sale leaves from it; null = no truck known (the
/// API then picks the seller's truck, else the main dépôt).
class CurrentTruck {
  CurrentTruck(this._today);

  final TodayRepository _today;
  VehicleRef? _cached;
  bool _loaded = false;

  /// The cached truck; [refresh] reads it again (the driver may change
  /// during the day on the web).
  Future<VehicleRef?> get({bool refresh = false}) async {
    if (_loaded && !refresh) return _cached;
    final result = await _today.today();
    if (result case Success(:final data)) {
      _cached = data.vehicle;
      _loaded = true;
    }
    return _cached;
  }

  void clear() {
    _cached = null;
    _loaded = false;
  }
}
