import 'package:flutter/material.dart';

import '../design/design.dart';

/// The floating tab bar's height over a tab root's content (its pill, its
/// margin, the system inset): a map on a tab root stops above it, so the
/// credit, the controls and the notices under the map are never covered.
double tabBarInset(BuildContext context) =>
    MediaQuery.paddingOf(context).bottom + 80;

/// A map with its notices under it: the map takes the room left, the
/// notices sit between it and [bottomInset] (the tab bar on a tab root).
class MapWithNotices extends StatelessWidget {
  const MapWithNotices({
    super.key,
    required this.map,
    this.notices = const [],
    this.bottomInset = 0,
  });

  final Widget map;
  final List<Widget> notices;
  final double bottomInset;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Expanded(child: map),
      if (notices.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.sm,
            AppSpacing.lg,
            0,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < notices.length; i++) ...[
                if (i > 0) AppSpacing.gapXs,
                notices[i],
              ],
            ],
          ),
        ),
      SizedBox(height: bottomInset + AppSpacing.xs),
    ],
  );
}

/// A row of map actions (layer switch, refresh) floating at the top end.
class MapTopBar extends StatelessWidget {
  const MapTopBar({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => PositionedDirectional(
    top: AppSpacing.sm,
    end: AppSpacing.md,
    start: AppSpacing.md,
    child: Wrap(
      alignment: WrapAlignment.end,
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.xs,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: children,
    ),
  );
}

/// A switch chip on the map ("Clients", "En dette"): readable over tiles.
class MapChip extends StatelessWidget {
  const MapChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onSelected,
    this.icon,
  });

  final String label;
  final bool selected;
  final ValueChanged<bool> onSelected;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => FilterChip(
    label: Text(label),
    avatar: icon == null || selected ? null : Icon(icon, size: 18),
    selected: selected,
    onSelected: onSelected,
    backgroundColor: Theme.of(context).colorScheme.surface,
    elevation: 2,
    pressElevation: 3,
    materialTapTargetSize: MaterialTapTargetSize.padded,
  );
}
