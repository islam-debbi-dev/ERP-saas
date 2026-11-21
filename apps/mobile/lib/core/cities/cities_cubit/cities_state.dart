import 'package:equatable/equatable.dart';
import '../../models/wilaya_model.dart';
import '../../models/commune_model.dart';

abstract class CitiesState extends Equatable {
  const CitiesState();

  @override
  List<Object?> get props => [];
}

class CitiesInitial extends CitiesState {}

class CitiesLoading extends CitiesState {}

class CitiesLoaded extends CitiesState {
  final List<WilayaModel> wilayas;
  final List<CommuneModel> communes;
  final WilayaModel? selectedWilaya;
  final CommuneModel? selectedCommune;
  final List<CommuneModel> filteredCommunes;

  const CitiesLoaded({
    required this.wilayas,
    required this.communes,
    this.selectedWilaya,
    this.selectedCommune,
    required this.filteredCommunes,
  });

  CitiesLoaded updateWilaya(WilayaModel? wilaya, List<CommuneModel> filtered) {
    return CitiesLoaded(
      wilayas: wilayas,
      communes: communes,
      selectedWilaya: wilaya,
      selectedCommune: null,
      filteredCommunes: filtered,
    );
  }
  
  CitiesLoaded updateCommune(CommuneModel? commune) {
    return CitiesLoaded(
      wilayas: wilayas,
      communes: communes,
      selectedWilaya: selectedWilaya,
      selectedCommune: commune,
      filteredCommunes: filteredCommunes,
    );
  }

  @override
  List<Object?> get props => [
        wilayas,
        communes,
        selectedWilaya,
        selectedCommune,
        filteredCommunes,
      ];
}

class CitiesError extends CitiesState {
  final String message;
  const CitiesError(this.message);

  @override
  List<Object> get props => [message];
}
