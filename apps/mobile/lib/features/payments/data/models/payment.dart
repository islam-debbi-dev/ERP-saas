import 'package:decimal/decimal.dart';
import 'package:json_annotation/json_annotation.dart';

import '../../../../core/models/json_converters.dart';

part 'payment.g.dart';

/// A versement (`PaymentDto` in `packages/shared/src/schemas/payments.ts`).
@JsonSerializable(createToJson: false)
class Payment {
  const Payment({
    required this.id,
    required this.number,
    required this.amount,
    required this.mode,
    required this.status,
    required this.receivedAt,
    this.client,
    this.reference,
    this.bank,
    this.dueDate,
    this.note,
    this.allocations = const [],
    this.geoCheck,
  });

  final String id;
  final String number;
  final PaymentClient? client;
  @DecimalConverter()
  final Decimal amount;
  final String mode;
  final String status;
  final String? reference;
  final String? bank;
  final String? dueDate;
  final String? note;
  final DateTime receivedAt;
  final List<PaymentAllocation> allocations;
  final Map<String, dynamic>? geoCheck;

  String? get geoStatus => geoCheck?['status'] as String?;

  factory Payment.fromJson(Map<String, dynamic> json) =>
      _$PaymentFromJson(json);
}

@JsonSerializable(createToJson: false)
class PaymentClient {
  const PaymentClient({
    required this.id,
    required this.code,
    required this.name,
  });

  final String id;
  final String code;
  final String name;

  factory PaymentClient.fromJson(Map<String, dynamic> json) =>
      _$PaymentClientFromJson(json);
}

@JsonSerializable(createToJson: false)
class PaymentAllocation {
  const PaymentAllocation({
    required this.saleId,
    required this.saleType,
    required this.amount,
    this.saleNumber,
  });

  final String saleId;
  final String? saleNumber;
  final String saleType;
  @DecimalConverter()
  final Decimal amount;

  factory PaymentAllocation.fromJson(Map<String, dynamic> json) =>
      _$PaymentAllocationFromJson(json);
}
