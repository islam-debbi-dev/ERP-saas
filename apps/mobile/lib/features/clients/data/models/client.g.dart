// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'client.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Client _$ClientFromJson(Map<String, dynamic> json) => Client(
  id: json['id'] as String,
  code: json['code'] as String,
  name: json['name'] as String,
  balance: const DecimalConverter().fromJson(json['balance'] as String),
  type: json['type'] as String? ?? 'PARTICULIER',
  phone: json['phone'] as String?,
  phone2: json['phone2'] as String?,
  address: json['address'] as String?,
  wilaya: json['wilaya'] as String?,
  commune: json['commune'] as String?,
  priceLevelId: json['priceLevelId'] as String?,
  creditLimit: const NullableDecimalConverter().fromJson(
    json['creditLimit'] as String?,
  ),
  overLimit: json['overLimit'] as bool? ?? false,
  active: json['active'] as bool? ?? true,
  version: (json['version'] as num?)?.toInt() ?? 1,
  location: json['location'] == null
      ? null
      : ClientLocation.fromJson(json['location'] as Map<String, dynamic>),
  notes: json['notes'] as String?,
);

ClientLocation _$ClientLocationFromJson(Map<String, dynamic> json) =>
    ClientLocation(
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      accuracyM: (json['accuracyM'] as num?)?.toDouble(),
      setAt: json['setAt'] == null
          ? null
          : DateTime.parse(json['setAt'] as String),
    );

UnpaidDocument _$UnpaidDocumentFromJson(Map<String, dynamic> json) =>
    UnpaidDocument(
      saleId: json['saleId'] as String,
      type: json['type'] as String,
      documentDate: json['documentDate'] as String,
      totalTtc: const DecimalConverter().fromJson(json['totalTtc'] as String),
      returned: const DecimalConverter().fromJson(json['returned'] as String),
      paid: const DecimalConverter().fromJson(json['paid'] as String),
      remaining: const DecimalConverter().fromJson(json['remaining'] as String),
      number: json['number'] as String?,
    );

ClientStatement _$ClientStatementFromJson(
  Map<String, dynamic> json,
) => ClientStatement(
  from: json['from'] as String,
  to: json['to'] as String,
  openingBalance: const DecimalConverter().fromJson(
    json['openingBalance'] as String,
  ),
  closingBalance: const DecimalConverter().fromJson(
    json['closingBalance'] as String,
  ),
  totalDebit: const DecimalConverter().fromJson(json['totalDebit'] as String),
  totalCredit: const DecimalConverter().fromJson(json['totalCredit'] as String),
  entries:
      (json['entries'] as List<dynamic>?)
          ?.map((e) => StatementEntry.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

StatementEntry _$StatementEntryFromJson(Map<String, dynamic> json) =>
    StatementEntry(
      id: json['id'] as String,
      type: json['type'] as String,
      amount: const DecimalConverter().fromJson(json['amount'] as String),
      label: json['label'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      runningBalance: const DecimalConverter().fromJson(
        json['runningBalance'] as String,
      ),
    );
