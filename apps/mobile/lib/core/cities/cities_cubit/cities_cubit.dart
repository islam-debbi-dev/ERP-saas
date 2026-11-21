import 'package:flutter_bloc/flutter_bloc.dart';
import '../cities_service.dart';
import '../../models/wilaya_model.dart';
import '../../models/commune_model.dart';
import 'cities_state.dart';

class CitiesCubit extends Cubit<CitiesState> {
  final CitiesService _citiesService;

  CitiesCubit(this._citiesService) : super(CitiesInitial());

  Future<void> loadCities() async {
    if (state is CitiesLoaded) return;
    emit(CitiesLoading());
    try {
      final wilayas = await _citiesService.getWilayas();
      final communes = await _citiesService.getCommunes();

      emit(
        CitiesLoaded(
          wilayas: wilayas,
          communes: communes,
          filteredCommunes: const [],
        ),
      );
    } catch (e) {
      print('CitiesCubit Error: $e');
      emit(CitiesError('Failed to load cities data: $e'));
    }
  }

  void selectWilaya(WilayaModel wilaya) {
    if (state is CitiesLoaded) {
      final currentState = state as CitiesLoaded;
      final filtered = currentState.communes
          .where((c) => c.wilayaId == wilaya.wilayaId)
          .toList();
      emit(currentState.updateWilaya(wilaya, filtered));
    }
  }

  void selectCommune(CommuneModel commune) {
    if (state is CitiesLoaded) {
      final currentState = state as CitiesLoaded;
      emit(currentState.updateCommune(commune));
    }
  }
}
