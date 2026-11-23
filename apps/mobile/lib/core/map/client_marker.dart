import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

/// What a client's marker says, most important first.
enum MarkerState {
  /// Visited today (the seller's day): done, whatever he owes.
  visited,

  /// Owes more than his plafond.
  overLimit,

  /// Owes something.
  debt,

  /// Owes nothing (or has an advance).
  clear,
}

/// The one colour rule of every map: visited today → grey with a check, debt
/// over the plafond → red, debt → orange, no debt → green.
MarkerState markerState({
  required Decimal balance,
  bool overLimit = false,
  bool visited = false,
}) {
  if (visited) return MarkerState.visited;
  if (overLimit) return MarkerState.overLimit;
  if (balance > Decimal.zero) return MarkerState.debt;
  return MarkerState.clear;
}

/// Fills with at least 4.5:1 against white text and rings (same family as the
/// web's map colours).
const markerColors = <MarkerState, Color>{
  MarkerState.visited: Color(0xFF6B7280),
  MarkerState.overLimit: Color(0xFFB91C1C),
  MarkerState.debt: Color(0xFFB45309),
  MarkerState.clear: Color(0xFF15803D),
};

/// Where a marker's ring and route lines are drawn in the brand-free blue.
const mapAccent = Color(0xFF1D4ED8);

/// The size of a marker on the map (its tap target).
const double markerSize = 44;

/// A client on a map: a coloured disc with the route number (or a check when
/// visited, or [icon]), and an optional count badge (orders to deliver).
class ClientMarker extends StatelessWidget {
  const ClientMarker({
    super.key,
    required this.state,
    required this.label,
    this.number,
    this.badge,
    this.icon,
    this.selected = false,
    this.onTap,
  });

  final MarkerState state;

  /// Screen reader label (the client's name).
  final String label;

  /// Place in the day's route; null = a plain point.
  final int? number;

  /// A count shown on the top end (orders); null or 0 = none.
  final int? badge;

  /// Shown instead of a number (e.g. off-route storefront).
  final IconData? icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = markerColors[state]!;
    final small =
        number == null && icon == null && state != MarkerState.visited;
    final disc = small ? 20.0 : 30.0;
    final Widget? inner = state == MarkerState.visited
        ? const Icon(Icons.check_rounded, size: 18, color: Colors.white)
        : number != null
        ? Text(
            '$number',
            textDirection: TextDirection.ltr,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w700,
              height: 1,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          )
        : icon != null
        ? Icon(icon, size: 16, color: Colors.white)
        : null;
    return Semantics(
      button: onTap != null,
      label: number == null ? label : '$number. $label',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: markerSize,
          height: markerSize,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              Container(
                width: disc,
                height: disc,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected ? Colors.black : Colors.white,
                    width: selected ? 3 : 2,
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x59000000),
                      blurRadius: 3,
                      offset: Offset(0, 1),
                    ),
                  ],
                ),
                child: inner,
              ),
              if ((badge ?? 0) > 0)
                PositionedDirectional(
                  top: 0,
                  end: 0,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 18),
                    height: 18,
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: mapAccent,
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                    child: Text(
                      '$badge',
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        height: 1,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
