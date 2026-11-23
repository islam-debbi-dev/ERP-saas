import 'package:flutter/material.dart';

import '../design/design.dart';
import '../localization/tr.dart';

enum ListOrMap { list, map }

/// "Liste / Carte" under a tab's app bar.
class MapListToggle extends StatelessWidget {
  const MapListToggle({
    super.key,
    required this.value,
    required this.onChanged,
  });

  final ListOrMap value;
  final ValueChanged<ListOrMap> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpacing.lg,
      AppSpacing.xs,
      AppSpacing.lg,
      AppSpacing.xs,
    ),
    child: SizedBox(
      width: double.infinity,
      child: SegmentedButton<ListOrMap>(
        showSelectedIcon: false,
        segments: [
          ButtonSegment(
            value: ListOrMap.list,
            icon: const Icon(Icons.view_list_outlined),
            label: Text(context.tr('map.view_list')),
          ),
          ButtonSegment(
            value: ListOrMap.map,
            icon: const Icon(Icons.map_outlined),
            label: Text(context.tr('map.view_map')),
          ),
        ],
        selected: {value},
        onSelectionChanged: (s) => onChanged(s.first),
      ),
    ),
  );
}

/// A strip pinned over the bottom of a map ("3 clients sans position",
/// "Zoomez pour voir tous les clients").
class MapNotice extends StatelessWidget {
  const MapNotice({
    super.key,
    required this.icon,
    required this.text,
    this.onTap,
  });

  final IconData icon;
  final String text;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      elevation: 2,
      borderRadius: AppRadius.mdAll,
      child: InkWell(
        borderRadius: AppRadius.mdAll,
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            child: Row(
              children: [
                Icon(icon, size: 20, color: context.textMuted),
                AppSpacing.gapSm,
                Expanded(child: Text(text, style: style)),
                if (onTap != null)
                  Icon(Icons.expand_more_rounded, color: context.textFaint),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
