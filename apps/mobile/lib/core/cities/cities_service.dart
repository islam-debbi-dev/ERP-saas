import 'dart:convert';
import 'package:flutter/services.dart';
import '../models/wilaya_model.dart';
import '../models/commune_model.dart';

class CitiesService {
  Future<Map<String, dynamic>> loadCitiesData() async {
    try {
      final String response = await rootBundle.loadString(
        'lib/core/cities/cities.json',
      );
      final data = await json.decode(response);
      return data;
    } catch (e) {
      throw Exception('Failed to load cities: $e');
    }
  }

  Future<List<WilayaModel>> getWilayas() async {
    final data = await loadCitiesData();
    return (data['wilayas'] as List)
        .map((w) => WilayaModel.fromJson(w))
        .toList();
  }

  Future<List<CommuneModel>> getCommunes() async {
    final data = await loadCitiesData();
    return (data['communes'] as List)
        .map((c) => CommuneModel.fromJson(c))
        .toList();
  }
}
