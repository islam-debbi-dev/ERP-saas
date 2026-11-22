// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Payment _$PaymentFromJson(Map<String, dynamic> json) => Payment(
  id: json['id'] as String,
  number: json['number'] as String,
  amount: const DecimalConverter().fromJson(json['amount'] as String),
  mode: json['mode'] as String,
  status: json['status'] as String,
  receivedAt: DateTime.parse(json['receivedAt'] as String),
  client: json['client'] == null
      ? null
      : PaymentClient.fromJson(json['client'] as Map<String, dynamic>),
  reference: json['reference'] as String?,
  bank: json['bank'] as String?,
  dueDate: json['dueDate'] as String?,
  note: json['note'] as String?,
  allocations:
      (json['allocations'] as List<dynamic>?)
          ?.map((e) => PaymentAllocation.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  geoCheck: json['geoCheck'] as Map<String, dynamic>?,
);

PaymentClient _$PaymentClientFromJson(Map<String, dynamic> json) =>
    PaymentClient(
      id: json['id'] as String,
      code: json['code'] as String,
      name: json['name'] as String,
    );

PaymentAllocation _$PaymentAllocationFromJson(Map<String, dynamic> json) =>
    PaymentAllocation(
      saleId: json['saleId'] as String,
      saleType: json['saleType'] as String,
      amount: const DecimalConverter().fromJson(json['amount'] as String),
      saleNumber: json['saleNumber'] as String?,
    );
