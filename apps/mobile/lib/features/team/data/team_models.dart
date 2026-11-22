import 'package:decimal/decimal.dart';

import '../../../core/models/json_converters.dart';
import '../../truck/data/models/me_day.dart';

Decimal? _decimal(Object? v) => v == null ? null : Decimal.parse(v as String);

UserRef? _user(Object? v) =>
    v == null ? null : UserRef.fromJson(v as Map<String, dynamic>);

NamedRef? _named(Object? v) =>
    v == null ? null : NamedRef.fromJson(v as Map<String, dynamic>);

/// A correction of a closed day (`SellerSessionAdjustmentDto`): a new row,
/// the closed session never changes.
class SessionAdjustment {
  const SessionAdjustment({
    required this.id,
    required this.at,
    this.handedCash,
    this.ecart,
    this.note,
    this.by,
  });

  final String id;
  final Decimal? handedCash;
  final Decimal? ecart;
  final String? note;
  final UserRef? by;
  final DateTime at;

  factory SessionAdjustment.fromJson(Map<String, dynamic> json) =>
      SessionAdjustment(
        id: json['id'] as String,
        handedCash: _decimal(json['handedCash']),
        ecart: _decimal(json['ecart']),
        note: json['note'] as String?,
        by: _user(json['by']),
        at: DateTime.parse(json['at'] as String),
      );
}

/// A seller's day (`SellerSessionDto` in
/// `packages/shared/src/schemas/tournees.ts`). [expected] is frozen at
/// closing and live while OPEN; [ecart] = handed − expected (server's rule).
class SellerSession {
  const SellerSession({
    required this.id,
    required this.seller,
    required this.date,
    required this.status,
    required this.expected,
    this.warehouse,
    this.handedCash,
    this.ecart,
    this.note,
    this.closedBy,
    this.closedAt,
    this.adjustments = const [],
  });

  final String id;
  final UserRef seller;
  final String date;
  final String status;
  final NamedRef? warehouse;
  final ExpectedCash expected;
  final Decimal? handedCash;
  final Decimal? ecart;
  final String? note;
  final UserRef? closedBy;
  final DateTime? closedAt;
  final List<SessionAdjustment> adjustments;

  bool get isOpen => status == 'OPEN';

  /// The count that holds now: the last correction's, else the closing's.
  Decimal? get currentHanded {
    for (final a in adjustments.reversed) {
      if (a.handedCash != null) return a.handedCash;
    }
    return handedCash;
  }

  /// The écart that holds now (a correction with a new count replaces it).
  Decimal? get currentEcart {
    for (final a in adjustments.reversed) {
      if (a.ecart != null) return a.ecart;
    }
    return ecart;
  }

  factory SellerSession.fromJson(Map<String, dynamic> json) => SellerSession(
    id: json['id'] as String,
    seller: UserRef.fromJson(json['seller'] as Map<String, dynamic>),
    date: json['date'] as String,
    status: json['status'] as String,
    warehouse: _named(json['warehouse']),
    expected: ExpectedCash.fromJson(json['expected'] as Map<String, dynamic>),
    handedCash: _decimal(json['handedCash']),
    ecart: _decimal(json['ecart']),
    note: json['note'] as String?,
    closedBy: _user(json['closedBy']),
    closedAt: json['closedAt'] == null
        ? null
        : DateTime.parse(json['closedAt'] as String),
    adjustments: [
      for (final a in (json['adjustments'] as List<dynamic>? ?? const []))
        SessionAdjustment.fromJson(a as Map<String, dynamic>),
    ],
  );
}

/// One member of the team and his day (`SellerDayDto`), session or not.
/// Only the members the API returns for the supervisor exist on the phone.
class SellerDay {
  const SellerDay({
    required this.seller,
    required this.date,
    required this.expected,
    this.session,
    this.vehicle,
  });

  final UserRef seller;
  final String date;
  final SellerSession? session;

  /// Live figure, the clôture's rule (cash only).
  final ExpectedCash expected;

  /// The truck he drives now; null = none.
  final NamedRef? vehicle;

  factory SellerDay.fromJson(Map<String, dynamic> json) => SellerDay(
    seller: UserRef.fromJson(json['seller'] as Map<String, dynamic>),
    date: json['date'] as String,
    session: json['session'] == null
        ? null
        : SellerSession.fromJson(json['session'] as Map<String, dynamic>),
    expected: ExpectedCash.fromJson(json['expected'] as Map<String, dynamic>),
    vehicle: _named(json['vehicle']),
  );
}

/// `POST /seller-sessions/:id/close`: the closed day and what is left on
/// the truck (to offer a déchargement).
class SessionCloseResult {
  const SessionCloseResult({required this.session, required this.truckStock});

  final SellerSession session;
  final List<TruckStockLine> truckStock;

  factory SessionCloseResult.fromJson(Map<String, dynamic> json) =>
      SessionCloseResult(
        session: SellerSession.fromJson(
          json['session'] as Map<String, dynamic>,
        ),
        truckStock: [
          for (final l in (json['vehicleStock'] as List<dynamic>? ?? const []))
            TruckStockLine.fromJson(l as Map<String, dynamic>),
        ],
      );
}

/// A member's validated sales of the day (`SaleListSummary`).
class SalesSummary {
  const SalesSummary({required this.count, required this.netTtc});

  final int count;
  final Decimal netTtc;

  factory SalesSummary.fromJson(Map<String, dynamic> json) => SalesSummary(
    count: json['count'] as int,
    netTtc: Decimal.parse(json['netTtc'] as String),
  );
}

/// What the member screen shows: his day, if he is in the team the API
/// returned, and his sales of that day (null when that read failed).
class MemberDay {
  const MemberDay({required this.team, this.day, this.sales});

  /// The whole team of that day, as the API returned it.
  final List<SellerDay> team;

  /// Null = not in the supervisor's team: nothing else is read.
  final SellerDay? day;
  final SalesSummary? sales;

  bool get inTeam => day != null;
}

/// A truck the supervisor may put a driver on (`WarehouseDto`, type VEHICLE).
class TruckOption {
  const TruckOption({
    required this.id,
    required this.name,
    this.code,
    this.driver,
    this.activity,
  });

  final String id;
  final String name;
  final String? code;
  final UserRef? driver;

  /// The vehicle type's activity (CASH_VAN, PRESALE, DELIVERY, MIXED).
  final String? activity;

  bool get isDelivery => activity == 'DELIVERY';

  /// `code · name`, or the name alone (codes shown as typed, LTR).
  String get label => code == null || code!.isEmpty ? name : '$code · $name';

  factory TruckOption.fromJson(Map<String, dynamic> json) => TruckOption(
    id: json['id'] as String,
    name: json['name'] as String,
    code: json['code'] as String?,
    driver: _user(json['assignedUser']),
    activity:
        (json['vehicleType'] as Map<String, dynamic>?)?['activity'] as String?,
  );

  /// Live trucks only, from `GET /warehouses?type=VEHICLE`.
  static List<TruckOption> listFrom(Object? json) => [
    for (final w in json! as List<dynamic>)
      if ((w as Map<String, dynamic>)['active'] != false &&
          w['type'] == 'VEHICLE')
        TruckOption.fromJson(w),
  ];
}

/// `POST /warehouses/:id/driver` (`AssignDriverResultDto`).
class DriverChange {
  const DriverChange({
    required this.vehicleId,
    this.driver,
    this.previousDriver,
    this.freedVehicle,
  });

  final String vehicleId;
  final UserRef? driver;
  final UserRef? previousDriver;
  final VehicleRef? freedVehicle;

  factory DriverChange.fromJson(Map<String, dynamic> json) => DriverChange(
    vehicleId: json['vehicleId'] as String,
    driver: _user(json['driver']),
    previousDriver: _user(json['previousDriver']),
    freedVehicle: json['freedVehicle'] == null
        ? null
        : VehicleRef.fromJson(json['freedVehicle'] as Map<String, dynamic>),
  );
}
