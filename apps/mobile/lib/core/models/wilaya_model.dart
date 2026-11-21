class WilayaModel {
  final int wilayaId;
  final String wilayaNameLatin;
  final String wilayaNameArabic;

  WilayaModel({
    required this.wilayaId,
    required this.wilayaNameLatin,
    required this.wilayaNameArabic,
  });

  factory WilayaModel.fromJson(Map<String, dynamic> json) {
    return WilayaModel(
      wilayaId: json['wilaya_id'],
      wilayaNameLatin: json['wilaya_name_latin'],
      wilayaNameArabic: json['wilaya_name_arabic'],
    );
  }
}
