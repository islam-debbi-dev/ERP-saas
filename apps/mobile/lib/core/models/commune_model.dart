class CommuneModel {
  final int communeId;
  final int wilayaId;
  final String communeNameLatin;
  final String communeNameArabic;

  CommuneModel({
    required this.communeId,
    required this.wilayaId,
    required this.communeNameLatin,
    required this.communeNameArabic,
  });

  factory CommuneModel.fromJson(Map<String, dynamic> json) {
    return CommuneModel(
      communeId: json['commune_id'],
      wilayaId: json['wilaya_id'],
      communeNameLatin: json['commune_name_latin'],
      communeNameArabic: json['commune_name_arabic'],
    );
  }
}
