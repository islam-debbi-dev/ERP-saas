// import 'package:flutter/material.dart';

// import 'wilayas/data/models/baldia_model.dart';
// import 'wilayas/data/models/wilyase_model.dart';

// class LocalizationHelper {
//   /// Get the localized name for a wilaya based on current language
//   static String getWilayaName(BuildContext context, Wilaya wilaya) {
//     return Localizations.localeOf(context).languageCode == 'ar'
//         ? wilaya.name.ar
//         : wilaya.name.latin;
//   }

//   /// Get the localized name for a city based on current language
//   static String getCityName(BuildContext context, City city) {
//     return Localizations.localeOf(context).languageCode == 'ar'
//         ? city.name.ar
//         : city.name.latin;
//   }

//   /// Find a wilaya by its localized name
//   static Wilaya? findWilayaByName(
//     BuildContext context,
//     List<Wilaya> wilayas,
//     String name,
//   ) {
//     try {
//       return wilayas.firstWhere(
//         (wilaya) => getWilayaName(context, wilaya) == name,
//       );
//     } catch (e) {
//       return null;
//     }
//   }

//   /// Find a city by its localized name
//   static City? findCityByName(
//     BuildContext context,
//     List<City> cities,
//     String name,
//   ) {
//     try {
//       return cities.firstWhere((city) => getCityName(context, city) == name);
//     } catch (e) {
//       return null;
//     }
//   }
// }
