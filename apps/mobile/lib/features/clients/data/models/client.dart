import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'client.g.dart';

/// A client (`ClientDto` in `packages/shared/src/schemas/clients.ts`).
@JsonSerializable(createToJson: false)
class Client {
  const Client({
    required this.id,
    required this.code,
    required this.name,
    required this.balance,
    this.type = 'PARTICULIER',
    this.phone,
    this.phone2,
    this.address,
    this.wilaya,
    this.commune,
    this.priceLevelId,
    this.creditLimit,
    this.overLimit = false,
    this.active = true,
    this.version = 1,
    this.location,
    this.notes,
  });

  final String id;
  final String code;
  final String name;
  final String type;
  final String? phone;
  final String? phone2;
  final String? address;
  final String? wilaya;
  final String? commune;
  final String? priceLevelId;

  /// Plafond de crédit; null = no limit.
  @NullableDecimalConverter()
  final Decimal? creditLimit;

  /// Positive = owes us; negative = credit in the client's favour.
  @DecimalConverter()
  final Decimal balance;
  final bool overLimit;
  final bool active;
  final int version;
  final ClientLocation? location;
  final String? notes;

  /// What is left under the plafond (never negative); null without a plafond.
  Decimal? get creditLeft {
    final limit = creditLimit;
    if (limit == null) return null;
    final left = limit - balance;
    return left < Decimal.zero ? Decimal.zero : left;
  }

  factory Client.fromJson(Map<String, dynamic> json) => _$ClientFromJson(json);
}

/// The client's reference GPS point (phase 17).
@JsonSerializable(createToJson: false)
class ClientLocation {
  const ClientLocation({
    required this.lat,
    required this.lng,
    this.accuracyM,
    this.setAt,
  });

  final double lat;
  final double lng;
  final double? accuracyM;
  final DateTime? setAt;

  factory ClientLocation.fromJson(Map<String, dynamic> json) =>
      _$ClientLocationFromJson(json);
}

/// A row of the client list: from `GET /clients` or `POST /clients/nearby`
/// (the latter adds the distance).
class ClientRow {
  const ClientRow({
    required this.id,
    required this.code,
    required this.name,
    required this.balance,
    this.commune,
    this.phone,
    this.overLimit = false,
    this.distanceM,
  });

  final String id;
  final String code;
  final String name;
  final String? commune;
  final String? phone;
  final Decimal balance;
  final bool overLimit;
  final int? distanceM;

  factory ClientRow.fromClient(Client c) => ClientRow(
    id: c.id,
    code: c.code,
    name: c.name,
    commune: c.commune,
    phone: c.phone,
    balance: c.balance,
    overLimit: c.overLimit,
  );

  /// `ClientNearbyPointDto`.
  factory ClientRow.fromNearby(Map<String, dynamic> json) => ClientRow(
    id: json['id'] as String,
    code: json['code'] as String,
    name: json['name'] as String,
    commune: json['commune'] as String?,
    phone: json['phone'] as String?,
    balance: Decimal.parse(json['balance'] as String),
    overLimit: json['overLimit'] as bool? ?? false,
    distanceM: (json['distanceM'] as num?)?.round(),
  );
}

/// A document the client has not fully paid (`UnpaidDocumentDto`).
@JsonSerializable(createToJson: false)
class UnpaidDocument {
  const UnpaidDocument({
    required this.saleId,
    required this.type,
    required this.documentDate,
    required this.totalTtc,
    required this.returned,
    required this.paid,
    required this.remaining,
    this.number,
  });

  final String saleId;
  final String type;
  final String? number;
  final String documentDate;
  @DecimalConverter()
  final Decimal totalTtc;
  @DecimalConverter()
  final Decimal returned;
  @DecimalConverter()
  final Decimal paid;
  @DecimalConverter()
  final Decimal remaining;

  factory UnpaidDocument.fromJson(Map<String, dynamic> json) =>
      _$UnpaidDocumentFromJson(json);
}

/// Relevé de compte (`ClientStatementDto`).
@JsonSerializable(createToJson: false)
class ClientStatement {
  const ClientStatement({
    required this.from,
    required this.to,
    required this.openingBalance,
    required this.closingBalance,
    required this.totalDebit,
    required this.totalCredit,
    this.entries = const [],
  });

  final String from;
  final String to;
  @DecimalConverter()
  final Decimal openingBalance;
  @DecimalConverter()
  final Decimal closingBalance;
  @DecimalConverter()
  final Decimal totalDebit;
  @DecimalConverter()
  final Decimal totalCredit;
  final List<StatementEntry> entries;

  factory ClientStatement.fromJson(Map<String, dynamic> json) =>
      _$ClientStatementFromJson(json);
}

@JsonSerializable(createToJson: false)
class StatementEntry {
  const StatementEntry({
    required this.id,
    required this.type,
    required this.amount,
    required this.label,
    required this.createdAt,
    required this.runningBalance,
  });

  final String id;
  final String type;

  /// + the client owes more (sale), − he owes less (versement, avoir).
  @DecimalConverter()
  final Decimal amount;
  final String label;
  final DateTime createdAt;
  @DecimalConverter()
  final Decimal runningBalance;

  factory StatementEntry.fromJson(Map<String, dynamic> json) =>
      _$StatementEntryFromJson(json);
}
