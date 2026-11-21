import 'dart:io';
import 'dart:convert';

void main() {
  try {
    final file = File('lib/core/cities/cities.json');
    final response = file.readAsStringSync();
    final data = json.decode(response);
    print('Wilayas: ${data['wilayas'].length}');
    print('Communes: ${data['communes'].length}');
    final w = data['wilayas'][0];
    print('Wilaya 0: $w');
  } catch (e) {
    print('Error: $e');
  }
}
